# To enable Azure Trusted Signing on Windows builds:
# copy this file to set-azure-vars.ps1 and fill in your values
# (set-azure-vars.ps1 is git-ignored)

$env:AZURE_TENANT_ID                = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
$env:AZURE_CLIENT_ID                = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
$env:AZURE_CLIENT_SECRET            = "your-client-secret"
$env:AZURE_TRUSTED_SIGNING_ENDPOINT = "https://<your-account>.codesigning.azure.net"
$env:AZURE_TRUSTED_SIGNING_ACCOUNT  = "your-account-name"
$env:AZURE_TRUSTED_SIGNING_PROFILE  = "your-certificate-profile-name"
