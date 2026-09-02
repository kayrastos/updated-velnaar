#!/usr/bin/env python3

import gc
import hashlib
import json
import time
from pathlib import Path

import torch
import torch.nn.functional as F
from peft import LoraConfig, get_peft_model
from transformers import AutoTokenizer, BitsAndBytesConfig, Qwen3_5ForCausalLM
from trl.chat_template_utils import get_training_chat_template


MODEL = "Qwen/Qwen3.5-4B"
REVISION = "851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a"
DATA_FILE = Path("training/snapshots/sft_v1_gold_200.jsonl")

SEED = 42
EXPECTED_RECORDS = 200
EXPECTED_TRAINABLE = 565_248
LOSS_CHUNK_SIZE = 4
LEARNING_RATE = 1e-4
WEIGHT_DECAY = 0.01
MAX_GRAD_NORM = 1.0

SYSTEM_PROMPT_VERSION = "behavior_contract_compact_v2"
SYSTEM_PROMPT = (
    "Sen KayraAI'sın. En az veri ve izin kullan; kişisel veya gizli veriyi "
    "izinsiz paylaşma ya da gereksiz veya süresiz saklama. Kullanıcıyı "
    "aldatma, hatayı gizleme veya seçimini habersiz değiştirme. Çatışmada "
    "son açık talimatı izle. Araç sonucunu doğrulamadan başarı iddia etme. "
    "Kısa, doğru ve istenen biçimde yanıtla."
)
SYSTEM_MESSAGE = {"role": "system", "content": SYSTEM_PROMPT}


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as file:
        while True:
            block = file.read(1024 * 1024)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def gib(value):
    return value / 1024**3


print("=== QWEN3.5-4B R4 CONTRACT PREFLIGHT ===", flush=True)

if not torch.cuda.is_available():
    raise RuntimeError("CUDA kullanılamıyor.")

print("GPU:", torch.cuda.get_device_name(0))
torch.set_num_threads(6)
torch.manual_seed(SEED)

free_before, total_bytes = torch.cuda.mem_get_info()
print("VRAM_total_GiB:", round(gib(total_bytes), 3))
print("VRAM_free_before_load_GiB:", round(gib(free_before), 3))

if free_before < 3.15 * 1024**3:
    raise RuntimeError(
        "Ön test için boş VRAM yetersiz. GPU kullanan uygulamaları kapatıp "
        "en az 3.15 GiB boş VRAM ile yeniden çalıştır."
    )

if not DATA_FILE.is_file():
    raise RuntimeError(f"Gold veri dosyası bulunamadı: {DATA_FILE}")

data_sha256 = sha256_file(DATA_FILE)
system_prompt_sha256 = hashlib.sha256(
    SYSTEM_PROMPT.encode("utf-8")
).hexdigest()

tokenizer = AutoTokenizer.from_pretrained(
    MODEL,
    revision=REVISION,
    local_files_only=True,
)

training_template = get_training_chat_template(tokenizer)
if training_template is not None:
    tokenizer.chat_template = training_template

records = []
with DATA_FILE.open("r", encoding="utf-8") as file:
    for line_number, line in enumerate(file, 1):
        if not line.strip():
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError as error:
            raise RuntimeError(
                f"Gold JSONL satır {line_number}: {error}"
            ) from error

if len(records) != EXPECTED_RECORDS:
    raise RuntimeError(
        f"Beklenen {EXPECTED_RECORDS} Gold kaydı, bulunan {len(records)}."
    )

encoded_records = []
for record in records:
    original_messages = record.get("messages")
    if not isinstance(original_messages, list) or not original_messages:
        raise RuntimeError(f"Geçersiz messages alanı: {record.get('id')}")

    if any(message.get("role") == "system" for message in original_messages):
        raise RuntimeError(
            f"Gold kaydında beklenmeyen system mesajı: {record.get('id')}"
        )

    messages = [SYSTEM_MESSAGE, *original_messages]
    encoded = tokenizer.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=False,
        return_dict=True,
        return_tensors="pt",
        return_assistant_tokens_mask=True,
    )

    input_ids = encoded["input_ids"]
    attention_mask = encoded.get("attention_mask", torch.ones_like(input_ids))
    assistant_mask = encoded["assistant_masks"].bool()

    assistant_tokens = int(assistant_mask.sum())
    if assistant_tokens == 0:
        raise RuntimeError(f"Asistan maskesi boş: {record['id']}")

    encoded_records.append(
        {
            "record": record,
            "input_ids": input_ids,
            "attention_mask": attention_mask,
            "assistant_mask": assistant_mask,
            "sequence_tokens": int(input_ids.shape[1]),
            "assistant_tokens": assistant_tokens,
        }
    )

selected = max(encoded_records, key=lambda item: item["sequence_tokens"])
record = selected["record"]

print("records:", len(records))
print("data_SHA256:", data_sha256)
print("system_prompt_version:", SYSTEM_PROMPT_VERSION)
print("system_prompt_SHA256:", system_prompt_sha256)
print("selected_record_id:", record["id"])
print("selected_category:", record["category"])
print("sequence_tokens:", selected["sequence_tokens"])
print("assistant_tokens:", selected["assistant_tokens"])
print("loss_chunk_size:", LOSS_CHUNK_SIZE)
print("eval_data_used: False")

bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_use_double_quant=True,
    bnb_4bit_compute_dtype=torch.float16,
)

gc.collect()
torch.cuda.empty_cache()
load_started = time.perf_counter()

base_model = Qwen3_5ForCausalLM.from_pretrained(
    MODEL,
    revision=REVISION,
    quantization_config=bnb_config,
    dtype=torch.float16,
    device_map=0,
    low_cpu_mem_usage=True,
    local_files_only=True,
)

base_model.config.use_cache = False
for parameter in base_model.parameters():
    parameter.requires_grad_(False)

try:
    base_model.gradient_checkpointing_enable(
        gradient_checkpointing_kwargs={"use_reentrant": False}
    )
except TypeError:
    base_model.gradient_checkpointing_enable()

base_model.enable_input_require_grads()

lora_config = LoraConfig(
    r=4,
    lora_alpha=8,
    target_modules=(
        r"model\.layers\.(28|29|30|31)\.mlp\."
        r"(gate_proj|up_proj|down_proj)"
    ),
    lora_dropout=0.0,
    bias="none",
    task_type="CAUSAL_LM",
)

model = get_peft_model(base_model, lora_config)
model.enable_input_require_grads()
model.train()

trainable_parameters = [
    parameter for parameter in model.parameters() if parameter.requires_grad
]
trainable_count = sum(parameter.numel() for parameter in trainable_parameters)

if trainable_count != EXPECTED_TRAINABLE:
    raise RuntimeError(
        f"Beklenen {EXPECTED_TRAINABLE:,}, ölçülen {trainable_count:,} "
        "eğitilebilir parametre."
    )

if not all(
    str(parameter.device).startswith("cuda")
    for parameter in trainable_parameters
):
    raise RuntimeError("LoRA parametrelerinin tamamı GPU üzerinde değil.")

optimizer = torch.optim.AdamW(
    trainable_parameters,
    lr=LEARNING_RATE,
    weight_decay=WEIGHT_DECAY,
    foreach=False,
)

load_seconds = time.perf_counter() - load_started
print("load_seconds:", round(load_seconds, 2))
print("trainable_parameters:", trainable_count)
print("CUDA_allocated_after_load_GiB:", round(gib(torch.cuda.memory_allocated()), 3))

input_ids = selected["input_ids"].to("cuda")
attention_mask = selected["attention_mask"].to("cuda")
assistant_mask = selected["assistant_mask"].to("cuda")

optimizer.zero_grad(set_to_none=True)
gc.collect()
torch.cuda.empty_cache()
torch.cuda.reset_peak_memory_stats()

baseline_allocated = torch.cuda.memory_allocated()
step_started = time.perf_counter()
base_causal_lm = model.get_base_model()

try:
    backbone_output = base_causal_lm.model(
        input_ids=input_ids,
        attention_mask=attention_mask,
        use_cache=False,
        return_dict=True,
    )

    hidden_states = backbone_output.last_hidden_state
    shift_mask = assistant_mask[:, 1:] & attention_mask[:, 1:].bool()
    selected_hidden = hidden_states[:, :-1, :][shift_mask]
    selected_labels = input_ids[:, 1:][shift_mask]
    supervised_tokens = int(selected_labels.shape[0])

    if supervised_tokens != selected["assistant_tokens"]:
        raise RuntimeError(
            f"Assistant mask kayması: beklenen={selected['assistant_tokens']}, "
            f"ölçülen={supervised_tokens}"
        )

    loss_sum = 0.0
    for chunk_start in range(0, supervised_tokens, LOSS_CHUNK_SIZE):
        chunk_end = min(chunk_start + LOSS_CHUNK_SIZE, supervised_tokens)
        chunk_logits = base_causal_lm.lm_head(
            selected_hidden[chunk_start:chunk_end]
        ).float()
        chunk_loss = F.cross_entropy(
            chunk_logits,
            selected_labels[chunk_start:chunk_end],
            reduction="sum",
        )

        if not torch.isfinite(chunk_loss):
            raise RuntimeError("Sonlu olmayan loss oluştu.")

        normalized_loss = chunk_loss / supervised_tokens
        normalized_loss.backward(retain_graph=chunk_end < supervised_tokens)
        loss_sum += float(chunk_loss.detach())

        del chunk_logits, chunk_loss, normalized_loss

    gradient_norms = [
        parameter.grad.detach().float().norm()
        for parameter in trainable_parameters
        if parameter.grad is not None
    ]
    if not gradient_norms:
        raise RuntimeError("LoRA gradienti oluşmadı.")

    gradient_norm = torch.stack(gradient_norms).norm()
    if not torch.isfinite(gradient_norm):
        raise RuntimeError("Sonlu olmayan gradient oluştu.")

    torch.nn.utils.clip_grad_norm_(
        trainable_parameters,
        MAX_GRAD_NORM,
        foreach=False,
    )
    optimizer.step()
    torch.cuda.synchronize()

except torch.cuda.OutOfMemoryError:
    peak_allocated = torch.cuda.max_memory_allocated()
    print("\n=== PREFLIGHT RESULT ===")
    print("status: OOM")
    print("CUDA_peak_GiB:", round(gib(peak_allocated), 3))
    print("QWEN3.5-4B R4 CONTRACT PREFLIGHT OOM")
    raise SystemExit(2)

step_seconds = time.perf_counter() - step_started
peak_allocated = torch.cuda.max_memory_allocated()
free_after, _ = torch.cuda.mem_get_info()
average_loss = loss_sum / supervised_tokens

print("\n=== PREFLIGHT RESULT ===")
print("status: PASS")
print("average_loss:", average_loss)
print("gradient_norm:", float(gradient_norm))
print("step_seconds:", round(step_seconds, 2))
print("baseline_allocated_GiB:", round(gib(baseline_allocated), 3))
print("CUDA_peak_GiB:", round(gib(peak_allocated), 3))
print("step_delta_MiB:", round((peak_allocated - baseline_allocated) / 1024**2, 1))
print("VRAM_free_after_GiB:", round(gib(free_after), 3))
print("eval_data_used: False")
print("QWEN3.5-4B R4 CONTRACT PREFLIGHT PASS")
