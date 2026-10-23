param location string
param tags object
param token string
param legacyBaseUrl string
param sqlServerHost string
param infrastructureSubnetId string
param logAnalyticsWorkspaceId string
param appInsightsConnectionString string

// User-assigned so AcrPull and Key Vault access exist before the first revision is created.
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-web-${token}'
  location: location
  tags: tags
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'cr${token}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-${token}'
  location: location
  tags: tags
  properties: { tenantId: tenant().tenantId, sku: { family: 'A', name: 'standard' }, enableRbacAuthorization: true }
}

var acrPull = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
var secretsUser = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

resource pull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: registry
  name: guid(registry.id, identity.id, acrPull)
  properties: { roleDefinitionId: acrPull, principalId: identity.properties.principalId, principalType: 'ServicePrincipal' }
}

resource readSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  name: guid(vault.id, identity.id, secretsUser)
  properties: { roleDefinitionId: secretsUser, principalId: identity.properties.principalId, principalType: 'ServicePrincipal' }
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${token}'
  location: location
  tags: tags
  properties: {
    vnetConfiguration: { infrastructureSubnetId: infrastructureSubnetId }
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: reference(logAnalyticsWorkspaceId, '2023-09-01').customerId
        sharedKey: listKeys(logAnalyticsWorkspaceId, '2023-09-01').primarySharedKey
      }
    }
  }
}

resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-web-${token}'
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  dependsOn: [pull, readSecrets]
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Multiple'
      ingress: { external: true, targetPort: 8080, transport: 'auto' }
      registries: [{ server: registry.properties.loginServer, identity: identity.id }]
      secrets: [{ name: 'remote-app-api-key', keyVaultUrl: '${vault.properties.vaultUri}secrets/remote-app-api-key', identity: identity.id }]
    }
    template: {
      containers: [{
        name: 'web'
        image: 'mcr.microsoft.com/dotnet/samples:aspnetapp'
        env: [
          { name: 'Legacy__BaseUrl', value: legacyBaseUrl }
          { name: 'Legacy__RemoteAppApiKey', secretRef: 'remote-app-api-key' }
          { name: 'ConnectionStrings__Outdoor', value: 'Server=tcp:${sqlServerHost};Database=Outdoor;Authentication=Active Directory Default;Encrypt=True' }
          { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
          { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
        ]
        probes: [
          { type: 'Liveness', httpGet: { path: '/healthz/live', port: 8080 } }
          { type: 'Readiness', httpGet: { path: '/healthz/ready', port: 8080 } }
        ]
      }]
    }
  }
}

output registryLoginServer string = registry.properties.loginServer
output appName string = web.name