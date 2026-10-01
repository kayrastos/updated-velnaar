ARG TRAINING_BASE_IMAGE
FROM ${TRAINING_BASE_IMAGE}

WORKDIR /opt/fulgor

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV HF_HUB_DISABLE_TELEMETRY=1
ENV HF_HUB_DISABLE_IMPLICIT_TOKEN=1
ENV TOKENIZERS_PARALLELISM=false

COPY scripts/fulgor/training/python/qwen_qlora_executor.py /opt/fulgor/qwen_qlora_executor.py

USER 65532

ENTRYPOINT ["python3", "/opt/fulgor/qwen_qlora_executor.py"]
CMD ["--help"]