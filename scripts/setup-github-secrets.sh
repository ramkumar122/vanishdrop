#!/bin/bash
# Deploys the CDK stack and automatically sets all GitHub Secrets.
# Run this once after cloning. Never need to touch GitHub Secrets manually.
#
# Requirements:
#   - AWS CLI configured (aws configure)
#   - GitHub CLI installed and authenticated (gh auth login)
#   - jq installed (brew install jq)
#
# Usage:
#   REDIS_URL="rediss://default:xxx@host.upstash.io:6379" \
#   GITHUB_REPO="your-username/vanishdrop" \
#   bash scripts/setup-github-secrets.sh

set -e

# ── Validate inputs ───────────────────────────────────────────────────────────
if [ -z "$REDIS_URL" ]; then
  echo "Error: REDIS_URL is required (from Upstash dashboard)"
  echo "Usage: REDIS_URL='rediss://...' GITHUB_REPO='user/repo' bash scripts/setup-github-secrets.sh"
  exit 1
fi

if [ -z "$GITHUB_REPO" ]; then
  # Try to detect from git remote
  GITHUB_REPO=$(git remote get-url origin 2>/dev/null | sed 's/.*github.com[:/]//' | sed 's/\.git$//')
  if [ -z "$GITHUB_REPO" ]; then
    echo "Error: GITHUB_REPO is required (e.g. your-username/vanishdrop)"
    exit 1
  fi
  echo "Detected GitHub repo: $GITHUB_REPO"
fi

# ── Deploy CDK stack ──────────────────────────────────────────────────────────
echo ""
echo "Deploying CDK stack..."
cd "$(dirname "$0")/../infra"

# Pass the GitHub repo as context so OIDC trust policy is scoped correctly
cdk deploy \
  --context githubRepo="$GITHUB_REPO" \
  --outputs-file outputs.json \
  --require-approval never

# ── Parse outputs ─────────────────────────────────────────────────────────────
echo ""
echo "Parsing CDK outputs..."

STACK="VanishDropStack"
S3_BUCKET=$(jq -r ".${STACK}.UploadsBucketName" outputs.json)
S3_TEST_BUCKET=$(jq -r ".${STACK}.TestUploadsBucketName" outputs.json)
DEPLOY_BUCKET=$(jq -r ".${STACK}.DeployBucketName" outputs.json)
AWS_ROLE_ARN=$(jq -r ".${STACK}.GitHubActionsRoleArn" outputs.json)
AWS_REGION=$(jq -r ".${STACK}.Region" outputs.json)
SERVER_IP=$(jq -r ".${STACK}.ServerIP" outputs.json)
EC2_INSTANCE_ID=$(jq -r ".${STACK}.InstanceId" outputs.json)

# ── Set GitHub Secrets ────────────────────────────────────────────────────────
echo ""
echo "Setting GitHub Secrets for $GITHUB_REPO..."

gh secret set REDIS_URL         --body "$REDIS_URL"        --repo "$GITHUB_REPO"
gh secret set S3_BUCKET         --body "$S3_BUCKET"        --repo "$GITHUB_REPO"
gh secret set S3_TEST_BUCKET    --body "$S3_TEST_BUCKET"   --repo "$GITHUB_REPO"
gh secret set DEPLOY_BUCKET     --body "$DEPLOY_BUCKET"    --repo "$GITHUB_REPO"
gh secret set AWS_ROLE_ARN      --body "$AWS_ROLE_ARN"     --repo "$GITHUB_REPO"
gh secret set AWS_REGION        --body "$AWS_REGION"       --repo "$GITHUB_REPO"
gh secret set EC2_INSTANCE_ID   --body "$EC2_INSTANCE_ID"  --repo "$GITHUB_REPO"
# CORS_ORIGIN set after Cloudflare domain is ready
gh secret set CORS_ORIGIN       --body "http://$SERVER_IP" --repo "$GITHUB_REPO"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "All done! GitHub Secrets set automatically."
echo ""
echo "  Server IP      : $SERVER_IP"
echo "  EC2 Instance ID: $EC2_INSTANCE_ID"
echo "  Uploads Bucket : $S3_BUCKET"
echo "  Test Bucket    : $S3_TEST_BUCKET"
echo "  Region         : $AWS_REGION"
echo ""
echo "Next steps:"
echo "  1. Point your domain to $SERVER_IP in Cloudflare"
echo "  2. Update CORS_ORIGIN secret to your Cloudflare domain:"
echo "     gh secret set CORS_ORIGIN --body 'https://yourdomain.com' --repo $GITHUB_REPO"
echo ""
echo "Push to main to trigger your first deployment."
