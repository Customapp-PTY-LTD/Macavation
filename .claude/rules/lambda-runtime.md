# Lambda runtimes - always the current runtime, never an old one (Claude Code)

Apply this whenever you **create, update, deploy, or review an AWS Lambda function** in this repo:
a SAM/CloudFormation template, CDK or Terraform code, `serverless.yml`, a deploy script, an
`aws lambda create-function` / `update-function-configuration` call, a Lambda container image, or
a Lambda layer.

## Why

An old runtime eventually stops getting security patches from AWS, and anything still running on
it carries known CVEs nobody will fix. AWS also blocks creating, then updating, functions on a
retired runtime, so an old pin becomes a deploy that suddenly fails. Choosing the current runtime
when the function is written costs nothing; upgrading later under pressure costs a lot.

## The rule

- **Node.js Lambdas use `nodejs24.x` or newer.** Never `nodejs22.x`, `nodejs20.x`, `nodejs18.x`
  or anything older. When AWS releases a newer Node.js runtime, prefer the newest one.
- **Container-image Lambdas** use the matching AWS base image, for example
  `public.ecr.aws/lambda/nodejs:24` or newer - never an older tag, and never `latest` (an unpinned
  tag changes under you without a code change).
- **Other languages** (Python, .NET, Java, ...) use the newest runtime AWS currently supports for
  that language - never one AWS has announced a deprecation date for.
- **Write the runtime once.** Keep it in one place (a template `Globals` section, a shared
  constant, a single variable in the deploy script) so the next upgrade is a one-line change.
- **Match local tooling.** Set `engines.node` in `package.json` (and `.nvmrc` if the repo uses
  one) to the same major version, so local tests run on what Lambda runs.

## When you touch an existing function on an old runtime

Do not silently leave it. If the change you are making edits that function's configuration or
deploy path, upgrade the runtime in the same change and say so in the summary. If the upgrade is
out of scope or risky (a native module, an old SDK v2 import), **flag it to the user explicitly**
instead of copying the old runtime into new code.

## Dependencies are a separate CVE source

The runtime is only half the risk - most CVEs arrive through packaged libraries and layers. When
adding or upgrading Lambda dependencies, prefer current versions, and run `npm audit` (or the
language equivalent) before finishing.
