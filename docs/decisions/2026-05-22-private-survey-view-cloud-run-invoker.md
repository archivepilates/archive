# Private survey response view Cloud Run invoker policy

Date: 2026-05-22

## Context

`privateSurveyResponseView` is an external ARCHIVE IN survey detail endpoint used by members and instructors.

Firebase Functions deploys were reporting an IAM invoker warning when trying to apply public invoker access:

- Function: `privateSurveyResponseView`
- Region: `asia-northeast3`
- Project: `archive-pilates`
- Failure reason: organization policy `constraints/iam.allowedPolicyMemberDomains` blocks `allUsers`

## Decision

Do not rely on an `allUsers` IAM binding for this service while the organization policy blocks public IAM members.

Use Cloud Run's invoker IAM check disablement for this public survey-view service instead:

```sh
gcloud run services update privatesurveyresponseview \
  --region asia-northeast3 \
  --project archive-pilates \
  --no-invoker-iam-check
```

## Verified State

After applying the setting:

- `run.googleapis.com/invoker-iam-disabled`: `true`
- Cloud Run service URL: `https://privatesurveyresponseview-3bmxsf33jq-du.a.run.app`
- Service readiness: `Ready=True`
- Invalid test token reaches ARCHIVE IN application logic and returns the expected invalid-link response.

## Operating Note

If a future full Firebase Functions deploy tries to manage `privateSurveyResponseView` invoker IAM and fails on `allUsers`, keep the service public by re-applying `--no-invoker-iam-check`, or deploy the affected functions with a targeted `firebase deploy --only functions:<name>` command that excludes this public survey-view endpoint.
