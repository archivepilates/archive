# ArchiveIN Firebase Service Account Key

This folder contains an encrypted copy of the local Firebase/GCP service account key.

## File

- `archive-codex-operator.json.enc`

## Password Hint

- 6-digit number

## Restore On Another Mac

```bash
mkdir -p ~/.config/archive-pilates
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in archive-codex-operator.json.enc \
  -out ~/.config/archive-pilates/archive-codex-operator.json
chmod 600 ~/.config/archive-pilates/archive-codex-operator.json
```

Then add this to the shell profile, usually `~/.zshrc`.

```bash
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/archive-pilates/archive-codex-operator.json"
export GOOGLE_CLOUD_PROJECT="archive-pilates"
export GCLOUD_PROJECT="archive-pilates"
```

Verify access.

```bash
gcloud auth activate-service-account --key-file="$GOOGLE_APPLICATION_CREDENTIALS"
gcloud projects describe archive-pilates --format="value(projectId,projectNumber)"
GOOGLE_APPLICATION_CREDENTIALS="$GOOGLE_APPLICATION_CREDENTIALS" npx firebase projects:list --json
```

Do not commit or paste the decrypted JSON key.
