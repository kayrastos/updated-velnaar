FROM nvcr.io/nvidia/pytorch@sha256:ca73b4795f0d3ae27e9cd81b1b1f1b7fc6c0a129f7d51a359d2326e95af48a3d

LABEL io.velnar.fulgor.training-base-tag-provenance="26.05-py3"
LABEL io.velnar.fulgor.training-base-platform="linux/amd64"
LABEL io.velnar.fulgor.training-runtime-contract="FULGOR_QWEN_QLORA_TRAINING_IMAGE_RUNTIME_LOCK_V1"

WORKDIR /opt/fulgor

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV HF_HUB_DISABLE_TELEMETRY=1
ENV HF_HUB_DISABLE_IMPLICIT_TOKEN=1
ENV TOKENIZERS_PARALLELISM=false

COPY deploy/fulgor/qlora/runtime-lock.json /opt/fulgor/runtime-lock.json
COPY deploy/fulgor/qlora/requirements.direct.lock /opt/fulgor/requirements.direct.lock
COPY scripts/fulgor/training/python/qwen_qlora_executor.py /opt/fulgor/qwen_qlora_executor.py

USER 65532

ENTRYPOINT ["python3", "/opt/fulgor/qwen_qlora_executor.py"]
CMD ["--help"]