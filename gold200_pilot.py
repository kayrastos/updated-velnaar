import gc
import hashlib
import json
import math
import random
import shutil
import time
from collections import Counter, defaultdict
from pathlib import Path

import torch
import torch.nn.functional as F
from peft import LoraConfig, PeftModel, get_peft_model
from transformers import AutoTokenizer, BitsAndBytesConfig, Qwen3_5ForCausalLM
from trl.chat_template_utils import get_training_chat_template


MODEL = "Qwen/Qwen3.5-4B"
REVISION = "851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a"
DATA_FILE = Path("training/snapshots/sft_v1_gold_200.jsonl")
RUN_DIR = Path("training/runs/qwen3_5_4b_gold200_pilot_v1")
CHECKPOINT_DIR = RUN_DIR / "checkpoints"
FINAL_ADAPTER_DIR = RUN_DIR / "final_adapter"

SEED = 42
EPOCHS = 1
LEARNING_RATE = 1e-4
WEIGHT_DECAY = 0.01
MAX_GRAD_NORM = 1.0
LOSS_CHUNK_SIZE = 16
CHECKPOINT_EVERY = 10
EXPECTED_RECORDS = 200
EXPECTED_MAX_SEQUENCE = 131
EXPECTED_TRAINABLE = 282_624


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as file:
        while True:
            block = file.read(1024 * 1024)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as file:
        json.dump(value, file, ensure_ascii=False, indent=2)
        file.flush()
    temporary.replace(path)


def find_latest_checkpoint():
    if not CHECKPOINT_DIR.is_dir():
        return None

    candidates = []
    for path in CHECKPOINT_DIR.glob("step_*"):
        if not path.is_dir():
            continue
        try:
            step = int(path.name.split("_")[-1])
        except ValueError:
            continue

        required = [
            path / "adapter_model.safetensors",
            path / "adapter_config.json",
            path / "optimizer.pt",
            path / "training_state.json",
        ]

        if all(item.is_file() for item in required):
            candidates.append((step, path))

    if not candidates:
        return None

    return max(candidates, key=lambda item: item[0])[1]


def trim_metrics_log(max_step):
    metrics_path = RUN_DIR / "metrics.jsonl"
    if not metrics_path.is_file():
        return

    kept = []
    with metrics_path.open("r", encoding="utf-8") as file:
        for line in file:
            if not line.strip():
                continue
            item = json.loads(line)
            if int(item["global_step"]) <= max_step:
                kept.append(item)

    with metrics_path.open("w", encoding="utf-8") as file:
        for item in kept:
            file.write(json.dumps(item, ensure_ascii=False) + "\n")


print("=== QWEN3.5-4B GOLD-200 QLORA PILOT V1 ===", flush=True)
print("GPU:", torch.cuda.get_device_name(0))

if (RUN_DIR / "training_complete.json").is_file():
    print("Bu pilot daha önce tamamlanmış:", RUN_DIR)
    print("GOLD-200 PILOT ALREADY COMPLETE")
    raise SystemExit(0)

torch.set_num_threads(6)
torch.manual_seed(SEED)
random.seed(SEED)

free_bytes, total_bytes = torch.cuda.mem_get_info()
print("VRAM_total_GiB:", round(total_bytes / 1024**3, 3))
print("VRAM_free_before_load_GiB:", round(free_bytes / 1024**3, 3))

if free_bytes < 3.15 * 1024**3:
    raise RuntimeError(
        "Eğitim için boş VRAM yetersiz. GPU kullanan uygulamaları kapatıp "
        "en az 3.15 GiB boş VRAM ile yeniden çalıştır."
    )

RUN_DIR.mkdir(parents=True, exist_ok=True)
CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)

data_sha256 = sha256_file(DATA_FILE)

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
    for line in file:
        if line.strip():
            records.append(json.loads(line))

if len(records) != EXPECTED_RECORDS:
    raise RuntimeError(
        f"Beklenen {EXPECTED_RECORDS} Gold kaydı, bulunan {len(records)}."
    )

encoded_records = []
for record in records:
    encoded = tokenizer.apply_chat_template(
        record["messages"],
        tokenize=True,
        add_generation_prompt=False,
        return_dict=True,
        return_tensors="pt",
        return_assistant_tokens_mask=True,
    )

    input_ids = encoded["input_ids"]
    attention_mask = encoded.get("attention_mask", torch.ones_like(input_ids))
    assistant_mask = encoded["assistant_masks"].bool()

    if int(assistant_mask.sum()) == 0:
        raise RuntimeError(f"Asistan maskesi boş: {record['id']}")

    encoded_records.append(
        {
            "record": record,
            "input_ids": input_ids,
            "attention_mask": attention_mask,
            "assistant_mask": assistant_mask,
            "sequence_tokens": input_ids.shape[1],
            "assistant_tokens": int(assistant_mask.sum()),
        }
    )

maximum_sequence = max(item["sequence_tokens"] for item in encoded_records)
if maximum_sequence != EXPECTED_MAX_SEQUENCE:
    raise RuntimeError(
        f"Beklenen maksimum {EXPECTED_MAX_SEQUENCE}, ölçülen {maximum_sequence}."
    )

order = list(range(len(encoded_records)))
random.Random(SEED).shuffle(order)
order_record_ids = [encoded_records[index]["record"]["id"] for index in order]

category_counts = Counter(record["category"] for record in records)

manifest = {
    "run_name": RUN_DIR.name,
    "model": MODEL,
    "revision": REVISION,
    "data_file": str(DATA_FILE),
    "data_sha256": data_sha256,
    "record_count": len(records),
    "category_counts": dict(category_counts),
    "maximum_sequence_tokens": maximum_sequence,
    "eval_data_used": False,
    "seed": SEED,
    "epochs": EPOCHS,
    "learning_rate": LEARNING_RATE,
    "weight_decay": WEIGHT_DECAY,
    "max_grad_norm": MAX_GRAD_NORM,
    "loss_chunk_size": LOSS_CHUNK_SIZE,
    "checkpoint_every": CHECKPOINT_EVERY,
    "lora": {
        "r": 2,
        "alpha": 4,
        "dropout": 0.0,
        "layers": [28, 29, 30, 31],
        "modules": ["gate_proj", "up_proj", "down_proj"],
        "expected_trainable_parameters": EXPECTED_TRAINABLE,
    },
    "order_record_ids": order_record_ids,
}

manifest_path = RUN_DIR / "run_manifest.json"
if manifest_path.is_file():
    with manifest_path.open("r", encoding="utf-8") as file:
        existing_manifest = json.load(file)
    if existing_manifest != manifest:
        raise RuntimeError(
            "Mevcut run manifesti bu yapılandırmayla uyuşmuyor. "
            "Yeni bir run adı kullanmadan devam etme."
        )
else:
    write_json(manifest_path, manifest)

tokenizer.save_pretrained(RUN_DIR / "tokenizer")

latest_checkpoint = find_latest_checkpoint()
start_position = 0
global_step = 0
resume_state = None

if latest_checkpoint is not None:
    with (latest_checkpoint / "training_state.json").open(
        "r", encoding="utf-8"
    ) as file:
        resume_state = json.load(file)

    if resume_state["data_sha256"] != data_sha256:
        raise RuntimeError("Checkpoint ile Gold-200 SHA256 uyuşmuyor.")

    if resume_state["revision"] != REVISION:
        raise RuntimeError("Checkpoint model revision değeri uyuşmuyor.")

    start_position = int(resume_state["next_position"])
    global_step = int(resume_state["global_step"])
    trim_metrics_log(global_step)

    print("resume_checkpoint:", latest_checkpoint)
    print("resume_global_step:", global_step)
    print("resume_next_position:", start_position)
else:
    metrics_path = RUN_DIR / "metrics.jsonl"
    if metrics_path.exists():
        metrics_path.unlink()
    print("resume_checkpoint: NONE -- fresh training")

bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_use_double_quant=True,
    bnb_4bit_compute_dtype=torch.float16,
)

gc.collect()
torch.cuda.empty_cache()
load_start = time.perf_counter()

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

if latest_checkpoint is None:
    lora_config = LoraConfig(
        r=2,
        lora_alpha=4,
        target_modules=(
            r"model\.layers\.(28|29|30|31)\.mlp\."
            r"(gate_proj|up_proj|down_proj)"
        ),
        lora_dropout=0.0,
        bias="none",
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(base_model, lora_config)
else:
    model = PeftModel.from_pretrained(
        base_model,
        latest_checkpoint,
        is_trainable=True,
    )

model.enable_input_require_grads()
model.train()

trainable_parameters = [
    parameter for parameter in model.parameters() if parameter.requires_grad
]
trainable_count = sum(parameter.numel() for parameter in trainable_parameters)

if trainable_count != EXPECTED_TRAINABLE:
    raise RuntimeError(
        f"Beklenen {EXPECTED_TRAINABLE:,}, ölçülen {trainable_count:,}."
    )

if not all(str(parameter.device).startswith("cuda") for parameter in trainable_parameters):
    raise RuntimeError("LoRA parametrelerinin tamamı GPU üzerinde değil.")

optimizer = torch.optim.AdamW(
    trainable_parameters,
    lr=LEARNING_RATE,
    weight_decay=WEIGHT_DECAY,
    foreach=False,
)

if latest_checkpoint is not None:
    optimizer_state = torch.load(
        latest_checkpoint / "optimizer.pt",
        map_location="cpu",
        weights_only=False,
    )
    optimizer.load_state_dict(optimizer_state)
    del optimizer_state

    for parameter, state in optimizer.state.items():
        for key, value in list(state.items()):
            if torch.is_tensor(value):
                state[key] = value.to(parameter.device)

load_seconds = time.perf_counter() - load_start
print("load_seconds:", round(load_seconds, 2))
print("trainable_parameters:", trainable_count)
print("start_position:", start_position)
print("total_positions:", len(order))

base_causal_lm = model.get_base_model()
metrics_path = RUN_DIR / "metrics.jsonl"
session_start = time.perf_counter()
session_step_times = []


def save_checkpoint(next_position_value, global_step_value):
    final_path = CHECKPOINT_DIR / f"step_{global_step_value:04d}"
    if final_path.exists():
        raise RuntimeError(f"Checkpoint zaten var: {final_path}")

    temporary_path = CHECKPOINT_DIR / f".step_{global_step_value:04d}_tmp"
    if temporary_path.exists():
        shutil.rmtree(temporary_path)

    temporary_path.mkdir(parents=True)
    model.save_pretrained(temporary_path, safe_serialization=True)
    torch.save(optimizer.state_dict(), temporary_path / "optimizer.pt")

    state = {
        "global_step": global_step_value,
        "next_position": next_position_value,
        "epoch": 0,
        "data_sha256": data_sha256,
        "revision": REVISION,
        "loss_chunk_size": LOSS_CHUNK_SIZE,
        "saved_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    write_json(temporary_path / "training_state.json", state)

    adapter_path = temporary_path / "adapter_model.safetensors"
    state["adapter_sha256"] = sha256_file(adapter_path)
    write_json(temporary_path / "training_state.json", state)

    temporary_path.rename(final_path)
    print("checkpoint_saved:", final_path, flush=True)


for position in range(start_position, len(order)):
    item = encoded_records[order[position]]
    record = item["record"]

    input_ids = item["input_ids"].to("cuda")
    attention_mask = item["attention_mask"].to("cuda")
    assistant_mask = item["assistant_mask"].to("cuda")

    optimizer.zero_grad(set_to_none=True)
    gc.collect()
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()

    baseline_allocated = torch.cuda.memory_allocated()
    step_start = time.perf_counter()

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
    supervised_tokens = selected_labels.shape[0]

    if supervised_tokens != item["assistant_tokens"]:
        raise RuntimeError(f"Assistant mask kayması: {record['id']}")

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
            raise RuntimeError(f"Sonlu olmayan loss: {record['id']}")

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
        raise RuntimeError(f"Gradient oluşmadı: {record['id']}")

    gradient_norm = torch.stack(gradient_norms).norm()
    if not torch.isfinite(gradient_norm):
        raise RuntimeError(f"Sonlu olmayan gradient: {record['id']}")

    torch.nn.utils.clip_grad_norm_(
        trainable_parameters,
        MAX_GRAD_NORM,
        foreach=False,
    )

    optimizer.step()
    torch.cuda.synchronize()

    global_step += 1
    step_seconds = time.perf_counter() - step_start
    session_step_times.append(step_seconds)
    peak_allocated = torch.cuda.max_memory_allocated()
    free_after, _ = torch.cuda.mem_get_info()
    average_loss = loss_sum / supervised_tokens

    average_step_seconds = sum(session_step_times) / len(session_step_times)
    remaining_steps = len(order) - (position + 1)
    eta_hours = average_step_seconds * remaining_steps / 3600

    metric = {
        "global_step": global_step,
        "position": position,
        "record_id": record["id"],
        "category": record["category"],
        "sequence_tokens": item["sequence_tokens"],
        "assistant_tokens": supervised_tokens,
        "loss_chunks": math.ceil(supervised_tokens / LOSS_CHUNK_SIZE),
        "average_loss": average_loss,
        "gradient_norm": float(gradient_norm),
        "step_seconds": step_seconds,
        "baseline_allocated_gib": baseline_allocated / 1024**3,
        "cuda_peak_gib": peak_allocated / 1024**3,
        "vram_free_after_gib": free_after / 1024**3,
    }

    with metrics_path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(metric, ensure_ascii=False) + "\n")
        file.flush()

    print(
        f"[{global_step:03d}/{len(order)}] "
        f"id={record['id']} category={record['category']} "
        f"seq={item['sequence_tokens']} assistant={supervised_tokens} "
        f"loss={average_loss:.4f} grad={float(gradient_norm):.4f} "
        f"time={step_seconds:.1f}s peak={peak_allocated / 1024**3:.3f}GiB "
        f"ETA={eta_hours:.2f}h",
        flush=True,
    )

    del backbone_output, hidden_states, shift_mask
    del selected_hidden, selected_labels
    del input_ids, attention_mask, assistant_mask
    del gradient_norms, gradient_norm

    gc.collect()
    torch.cuda.empty_cache()

    if global_step % CHECKPOINT_EVERY == 0 or position + 1 == len(order):
        save_checkpoint(position + 1, global_step)


if FINAL_ADAPTER_DIR.exists():
    raise RuntimeError(f"Final adaptör klasörü zaten var: {FINAL_ADAPTER_DIR}")

temporary_final = RUN_DIR / ".final_adapter_tmp"
if temporary_final.exists():
    shutil.rmtree(temporary_final)
temporary_final.mkdir(parents=True)
model.save_pretrained(temporary_final, safe_serialization=True)
tokenizer.save_pretrained(temporary_final)
temporary_final.rename(FINAL_ADAPTER_DIR)

all_metrics = []
with metrics_path.open("r", encoding="utf-8") as file:
    for line in file:
        if line.strip():
            all_metrics.append(json.loads(line))

unique_metrics = {int(item["global_step"]): item for item in all_metrics}
all_metrics = [unique_metrics[step] for step in sorted(unique_metrics)]

if len(all_metrics) != EXPECTED_RECORDS:
    raise RuntimeError(
        f"Final metrik sayısı {EXPECTED_RECORDS} değil: {len(all_metrics)}"
    )

category_losses = defaultdict(list)
for item in all_metrics:
    category_losses[item["category"]].append(item["average_loss"])

summary = {
    "status": "complete",
    "completed_steps": global_step,
    "epochs": EPOCHS,
    "average_loss": sum(item["average_loss"] for item in all_metrics)
    / len(all_metrics),
    "average_step_seconds": sum(item["step_seconds"] for item in all_metrics)
    / len(all_metrics),
    "maximum_cuda_peak_gib": max(item["cuda_peak_gib"] for item in all_metrics),
    "category_average_losses": {
        category: sum(values) / len(values)
        for category, values in sorted(category_losses.items())
    },
    "final_adapter": str(FINAL_ADAPTER_DIR),
    "final_adapter_sha256": sha256_file(
        FINAL_ADAPTER_DIR / "adapter_model.safetensors"
    ),
    "data_sha256": data_sha256,
    "eval_data_used": False,
    "completed_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
}

write_json(RUN_DIR / "training_summary.json", summary)
write_json(RUN_DIR / "training_complete.json", summary)

print("\n=== GOLD-200 PILOT COMPLETE ===")
print("completed_steps:", summary["completed_steps"])
print("average_loss:", summary["average_loss"])
print("average_step_seconds:", summary["average_step_seconds"])
print("maximum_CUDA_peak_GiB:", summary["maximum_cuda_peak_gib"])
print("final_adapter:", summary["final_adapter"])
print("final_adapter_SHA256:", summary["final_adapter_sha256"])
print("eval_data_used:", summary["eval_data_used"])
print("QWEN3.5-4B GOLD-200 QLORA PILOT PASS")
