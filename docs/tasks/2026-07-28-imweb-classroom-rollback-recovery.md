# Imweb My Classroom rollback recovery

## Incident

- The live Imweb loader still requested the My Classroom JavaScript asset from the official ARCHIVE PILATES homepage.
- The latest official-home deployment came from a branch that did not contain that asset.
- Firebase Hosting rewrote the missing JavaScript request to the official-home HTML document.
- The loader marked the classroom as active before the asset executed, so the older inline fallback did not render.

## Recovery

- Restore the latest My Classroom asset to the current official-home source.
- Change the live loader cache key after the asset is deployed.
- Serve the classroom asset with JavaScript content type and no-store caching.
- Add an official-home predeploy validation that blocks deployment when the asset or required class markers are missing.

## Verification

- Pending deployment and live access-matrix checks.
