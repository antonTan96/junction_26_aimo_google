#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# AimoGate Automated Deployment Script (Google Cloud Run + Firebase Hosting)
# Project: junction26hel-7631
# Region: europe-north1
# ==============================================================================

PROJECT_ID="${PROJECT_ID:-junction26hel-7631}"
REGION="${REGION:-europe-north1}"
SERVICE_NAME="${SERVICE_NAME:-aimogate-api}"
DATACRUNCH_ENDPOINT="${DATACRUNCH_ENDPOINT:-https://containers.datacrunch.io/nemotron-3-5-super-vl-b300/v1}"
DATACRUNCH_MODEL="${DATACRUNCH_MODEL:-nemotron-3.5-super-vl}"
DATACRUNCH_API_KEY="${DATACRUNCH_API_KEY:-dc_176bde1bc2f74ecb83a0640d93d6bb20589aa5d227eaf9fd7208fe2985f7ded208b41c8f4049cf95c838f57290f0c94dfb8d0f4e93de8327352454c4ca19f230429045b393256b150e50a5738583b6b6e58e129bf00a0757a7b1b88c75c44118d1553782e5d0988f7698d3558c4b2ea2f8f974baee5038ebf153ac3bf671201a}"
VALIO_API_BASE_URL="${VALIO_API_BASE_URL:-https://junction26.valioaimo.fi}"
VALIO_API_KEY="${VALIO_API_KEY:-junct_tDnQn4VI_nfhELGCOEkY4vbuxm324MmYmILuokYG03Y}"

echo "============================================================"
echo "🚀 Starting Automated Deployment for AimoGate Procurement API"
echo "Project: $PROJECT_ID | Region: $REGION | Service: $SERVICE_NAME"
echo "============================================================"

# Check CLI dependencies
command -v gcloud >/dev/null 2>&1 || { echo "❌ gcloud CLI not found. Please install or run in Cloud Shell."; exit 1; }
command -v firebase >/dev/null 2>&1 || { echo "⚠️ firebase CLI not found. Attempting npx firebase..."; }

# Step 1: Run Pre-flight Verification Tests
echo ""
echo "🧪 [1/5] Running Pre-flight Verification Tests..."
DISABLE_REMOTE_LLM=true npx tsx src/lib/aimogate.test.ts
DISABLE_REMOTE_LLM=true npx tsx src/lib/rag.test.ts
npm run lint

# Step 2: Build Frontend SPA
echo ""
echo "📦 [2/5] Building Frontend Assets..."
npm run build

# Step 3: Deploy Backend to Cloud Run
echo ""
echo "☁️  [3/5] Deploying Cloud Run Service '$SERVICE_NAME'..."
gcloud run deploy "$SERVICE_NAME" \
  --project="$PROJECT_ID" \
  --source=. \
  --region="$REGION" \
  --allow-unauthenticated \
  --set-env-vars="DATACRUNCH_ENDPOINT=$DATACRUNCH_ENDPOINT,DATACRUNCH_MODEL=$DATACRUNCH_MODEL,DATACRUNCH_API_KEY=$DATACRUNCH_API_KEY,VALIO_API_BASE_URL=$VALIO_API_BASE_URL,VALIO_API_KEY=$VALIO_API_KEY"

# Retrieve Cloud Run Service URL
RUN_URL=$(gcloud run services describe "$SERVICE_NAME" --project="$PROJECT_ID" --region="$REGION" --format="value(status.url)")
echo "✅ Cloud Run deployed successfully: $RUN_URL"

# Step 4: Deploy Firebase Hosting (Option A with /api/** rewrite to Cloud Run)
echo ""
echo "🔥 [4/5] Deploying Firebase Hosting..."
if command -v firebase >/dev/null 2>&1; then
  firebase deploy --only hosting --project="$PROJECT_ID"
else
  npx firebase-tools deploy --only hosting --project="$PROJECT_ID"
fi

# Step 5: Post-deployment Health Check
echo ""
echo "🩺 [5/5] Performing Live Health & Catalog Status Check..."
sleep 2
STATUS_HTTP_CODE=$(curl -s -o /tmp/status_resp.json -w "%{http_code}" "$RUN_URL/api/v1/catalog/status" || echo "000")

if [ "$STATUS_HTTP_CODE" = "200" ]; then
  echo "✅ API responded HTTP 200 OK!"
  cat /tmp/status_resp.json | grep -o '"total_items":[0-9]*' || true
else
  echo "⚠️ Status endpoint returned HTTP $STATUS_HTTP_CODE (service may still be warming up)."
fi

echo ""
echo "============================================================"
echo "🎉 DEPLOYMENT COMPLETE!"
echo "Backend Cloud Run URL: $RUN_URL"
echo "Frontend Firebase URL: https://$PROJECT_ID.web.app"
echo "Catalog Status Check:  $RUN_URL/api/v1/catalog/status"
echo "============================================================"
