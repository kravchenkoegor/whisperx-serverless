from __future__ import annotations

import json
import os
from pathlib import Path

CONTENT_TYPES = {
    ".txt": "text/plain; charset=utf-8",
    ".srt": "text/plain; charset=utf-8",
    ".json": "application/json",
}


class Storage:
    def __init__(self):
        import boto3
        from botocore.config import Config

        self.bucket = os.environ["R2_BUCKET"]
        self.client = boto3.client(
            "s3",
            endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
            config=Config(signature_version="s3v4", retries={"max_attempts": 5, "mode": "standard"}),
        )

    def download(self, key: str, path: Path) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.client.download_file(self.bucket, key, str(path))
        return path

    def download_optional(self, key: str, path: Path) -> bool:
        from botocore.exceptions import ClientError

        try:
            self.download(key, path)
            return True
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return False
            raise

    def upload(self, path: Path, key: str) -> str:
        extra = {"ContentType": CONTENT_TYPES.get(path.suffix, "application/octet-stream")}
        self.client.upload_file(str(path), self.bucket, key, ExtraArgs=extra)
        return key

    def put_text(self, key: str, text: str) -> str:
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=text.encode("utf-8"),
            ContentType=CONTENT_TYPES[".txt"],
        )
        return key

    def put_json(self, key: str, data: dict) -> str:
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8"),
            ContentType=CONTENT_TYPES[".json"],
        )
        return key
