#!/usr/bin/env sh
# Grants the concierge's Entra agent identity read access to the policy index and the booking app role.
# Runs as the concierge postdeploy hook, because the identity is created by azd deploy.
set -eu

: "${AGENT_IDENTITY_NAME:?set it with azd env set}"
: "${AZURE_AI_SEARCH_RESOURCE_ID:?set it with azd env set}"
: "${BOOKING_API_APP_ID:?set it with azd env set}"
: "${BOOKING_API_ROLE_ID:?set it with azd env set}"

principal_id="$(az ad sp list --display-name "$AGENT_IDENTITY_NAME" --query '[0].id' -o tsv)"
[ -n "$principal_id" ] || { echo "Agent identity $AGENT_IDENTITY_NAME not found" >&2; exit 1; }

# Policy index: read only, scoped to the search service.
az role assignment create \
  --assignee-object-id "$principal_id" \
  --assignee-principal-type ServicePrincipal \
  --role "Search Index Data Reader" \
  --scope "$AZURE_AI_SEARCH_RESOURCE_ID" \
  --only-show-errors >/dev/null

# Booking API: app role on the booking app registration. Graph rejects a duplicate, so check first.
resource_id="$(az ad sp show --id "$BOOKING_API_APP_ID" --query id -o tsv)"
existing="$(az rest --method GET \
  --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$principal_id/appRoleAssignments" \
  --query "value[?appRoleId=='$BOOKING_API_ROLE_ID'] | length(@)" -o tsv)"
if [ "$existing" = "0" ]; then
  az rest --method POST \
    --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$principal_id/appRoleAssignments" \
    --body "{\"principalId\":\"$principal_id\",\"resourceId\":\"$resource_id\",\"appRoleId\":\"$BOOKING_API_ROLE_ID\"}" \
    >/dev/null
fi
echo "Access granted to $AGENT_IDENTITY_NAME"
