param location string
param tags object
param token string
param alertEmail string

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${token}'
  location: location
  tags: tags
  properties: { sku: { name: 'PerGB2018' } }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${token}'
  location: location
  tags: tags
  kind: 'web'
  properties: { Application_Type: 'web', WorkspaceResourceId: workspace.id }
}

resource team 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-store-${token}'
  location: 'global'
  tags: tags
  properties: { groupShortName: 'store', enabled: true, emailReceivers: [{ name: 'team', emailAddress: alertEmail }] }
}

// Checkout failures in actions the new host serves. Forwarded requests are logged under the YARP catch-all
// route name and are left out, so a legacy outage does not page for the new host.
resource checkoutFailures 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'alert-checkout-failures-${token}'
  location: location
  tags: tags
  properties: {
    displayName: 'Checkout requests failing in the new host'
    severity: 2
    enabled: true
    scopes: [workspace.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      allOf: [{
        query: 'AppRequests | where Name startswith "GET Checkout/" or Name startswith "POST Checkout/" | where Success == false'
        timeAggregation: 'Count'
        operator: 'GreaterThan'
        threshold: 0
        failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
      }]
    }
    actions: { actionGroups: [team.id] }
  }
}

output workspaceId string = workspace.id
output appInsightsConnectionString string = appInsights.properties.ConnectionString