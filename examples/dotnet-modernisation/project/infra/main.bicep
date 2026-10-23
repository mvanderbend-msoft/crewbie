targetScope = 'subscription'

@description('azd environment name, used to name resources.')
param environmentName string
param location string
@description('Public URL of the legacy IIS app that YARP forwards unported routes to.')
param legacyBaseUrl string
@description('Host name of the shared SQL Server (Entra authentication enabled).')
param sqlServerHost string
@description('Subnet with private connectivity to the on-premises network.')
param infrastructureSubnetId string
@description('Team distribution list for alerts.')
param alertEmail string

var tags = { 'azd-env-name': environmentName }
var token = uniqueString(subscription().id, environmentName)

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module monitoring 'modules/monitoring.bicep' = {
  scope: rg
  params: { location: location, tags: tags, token: token, alertEmail: alertEmail }
}

module app 'modules/app.bicep' = {
  scope: rg
  params: {
    location: location
    tags: tags
    token: token
    legacyBaseUrl: legacyBaseUrl
    sqlServerHost: sqlServerHost
    infrastructureSubnetId: infrastructureSubnetId
    logAnalyticsWorkspaceId: monitoring.outputs.workspaceId
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
  }
}

output AZURE_CONTAINER_REGISTRY_ENDPOINT string = app.outputs.registryLoginServer
output SERVICE_WEB_NAME string = app.outputs.appName
output SERVICE_WEB_STAGING_LABEL string = 'staging'