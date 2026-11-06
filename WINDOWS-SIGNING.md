# Windows Code Signing Setup Guide

This guide explains how to sign the Windows installer for i3X Explorer using
**Azure Trusted Signing** (formerly Azure Code Signing).

What signing gets you:

- **Windows 11 Smart App Control** blocks unsigned executables outright, with no
  "Run anyway". It checks every exe at launch, so the app inside the installer
  must be signed, not just the installer. Validly signed builds get past it.
- **SmartScreen** ("Windows protected your PC") is reputation-based. Signing
  names the publisher, but it does **not** suppress the warning by itself:
  reputation builds per signing identity and per file as people download and
  run releases. Expect new releases to warn for a while until that happens.

---

## How it works

The build script (`scripts/build-sign-win.ps1`) runs on a Windows machine and:

1. Runs `scripts/prepare-win-signing.ps1`, which finds `signtool.exe`,
   downloads the Azure Trusted Signing dlib from NuGet (cached in
   `scripts\.azure-signing\` after the first run) and writes its `metadata.json`
2. Builds with `electron-builder`, which signs **while packaging** by calling
   `scripts/winSign.cjs` for each file: the app exe and its DLLs before they go
   into the installers, the uninstaller, then the NSIS installer and the
   portable exe. DLLs that already carry a valid signature (Electron ships a
   couple signed by Microsoft) keep it.
   The hook runs `signtool.exe` with the dlib, which sends the file hash to
   Azure, receives the signature, and embeds it
3. Runs `scripts/verify-win-signing.ps1`: every installer and every exe in the
   unpacked app must carry our valid, timestamped signature, and every DLL a
   valid one from anyone. The build fails otherwise

Signing *after* electron-builder finishes (what this script used to do) leaves
the installed app exe unsigned, because it is already compressed inside the
installer. Don't go back to that.

The tag-triggered GitHub workflow (`.github/workflows/build-win.yml`) does the
same thing with the same credentials stored as repository secrets.

Authentication is handled via a service principal (app registration) in Entra ID.
Your private key never leaves Azure, only the file hash is transmitted.

---

## Prerequisites

### 1. Windows SDK (for `signtool.exe`)

The build searches for `signtool.exe` automatically. If it's not found, install
either:

- **Windows 10/11 SDK**: https://developer.microsoft.com/windows/downloads/windows-sdk/
  - During install, check **"Windows SDK Signing Tools for Desktop Apps"**
- **Visual Studio Build Tools**: https://visualstudio.microsoft.com/downloads/
  - Include the **"MSVC build tools"** workload

### 2. Node.js 20+

Download from https://nodejs.org (LTS build).

### 3. ImageMagick (for icon generation)

The script runs `generate-icons.ps1` automatically before building to produce
`build/icon.ico`. Install ImageMagick and make sure it is on your PATH:

```powershell
winget install -e --id ImageMagick.ImageMagick
```

Then open a new PowerShell window so the updated PATH takes effect.

### 4. Windows Developer Mode (for symlink support)

`electron-builder` downloads a toolkit that contains macOS symlinks. Extracting
them on Windows requires either Developer Mode or Administrator privileges.
Developer Mode is easier and persists across runs:

> **Settings → Privacy & Security → For developers → Developer Mode → On**

The build script will detect this and print a clear error if neither condition
is met.

### 5. PowerShell execution policy

Run once in an elevated PowerShell window:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

## Azure Setup

You need four things in Azure:

| Thing | What it is |
|-------|-----------|
| **Entra app registration** | The identity your script authenticates as |
| **Trusted Signing account** | The Azure resource that holds your signing config |
| **Certificate profile** | The specific cert/identity used to sign |
| **Role assignment** | Permission that links the app registration to the profile |

---

### Step 1: Find your Tenant ID

> **Portal path:** `Microsoft Entra ID` → `Overview`

On the **Overview** page, copy the **Tenant ID** field (a GUID).

```
AZURE_TENANT_ID = xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

---

### Step 2: Create an App Registration (or use an existing one)

> **Portal path:** `Microsoft Entra ID` → `App registrations` → `New registration`

1. Give it a name (e.g. `i3X Explorer Build`)
2. Leave **Supported account types** as *Single tenant*
3. No redirect URI needed, click **Register**

On the app's **Overview** page, copy the **Application (client) ID**:

```
AZURE_CLIENT_ID = xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

#### Create a client secret

> **Portal path:** (same app) → `Certificates & secrets` → `Client secrets` → `New client secret`

1. Set a description and expiry (1 or 2 years)
2. Click **Add**
3. **Copy the `Value` immediately**, it is only shown once

```
AZURE_CLIENT_SECRET = <the value shown, not the Secret ID>
```

> **Note:** When this secret expires, signing will silently fail.
> Add a calendar reminder before the expiry date to rotate it.

---

### Step 3: Find your Trusted Signing account details

> **Portal path:** `Trusted Signing accounts` → (your account) → `Overview`

On the Overview page you will find:

- **Name** is your account name:
  ```
  AZURE_TRUSTED_SIGNING_ACCOUNT = your-account-name
  ```

- **URI** is the endpoint (includes the region, e.g. `eus` for East US):
  ```
  AZURE_TRUSTED_SIGNING_ENDPOINT = https://eus.codesigning.azure.net
  ```
  Copy the URI exactly as shown (no trailing slash needed, but either works).

#### Find your Certificate Profile name

> **Portal path:** `Trusted Signing accounts` → (your account) → `Certificate profiles`

Copy the name of the profile you created:

```
AZURE_TRUSTED_SIGNING_PROFILE = your-profile-name
```

---

### Step 4: Grant the app registration permission to sign

This is the step people most often miss.

> **Portal path:** `Trusted Signing accounts` → (your account) → `Access control (IAM)` → `Add role assignment`

1. Click **Add role assignment**
2. On the **Role** tab, search for **Trusted Signing Certificate Profile Signer** and select it
3. On the **Members** tab, choose **User, group, or service principal** and search for
   the app registration you created in Step 2
4. Click **Review + assign**

> The role must be assigned at the **Trusted Signing account** level, not at the
> resource group or subscription level.

---

## Configuring the Build Script

Copy the credential template and fill it in:

```powershell
copy scripts\set-azure-vars.example.ps1 scripts\set-azure-vars.ps1
```

Edit `scripts\set-azure-vars.ps1`:

```powershell
$env:AZURE_TENANT_ID                = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
$env:AZURE_CLIENT_ID                = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
$env:AZURE_CLIENT_SECRET            = "your-client-secret-value"
$env:AZURE_TRUSTED_SIGNING_ENDPOINT = "https://eus.codesigning.azure.net"
$env:AZURE_TRUSTED_SIGNING_ACCOUNT  = "your-account-name"
$env:AZURE_TRUSTED_SIGNING_PROFILE  = "your-profile-name"
```

This file is listed in `.gitignore` and will not be committed.

---

## Running the Build

From the project root in PowerShell:

```powershell
.\scripts\build-sign-win.ps1
```

The script runs `npm ci` first, so it always builds against exactly what
`package-lock.json` pins (close any running instance of the app first).

On the first run the script downloads the Azure Trusted Signing dlib from
NuGet and caches it in `scripts\.azure-signing\`. Subsequent runs use the cache.

Signed `.exe` files are written to `release\<version>\`.

---

## Verifying the Signature

After signing, right-click an `.exe` → **Properties** → **Digital Signatures** tab.
You should see a signature from your certificate profile's publisher name, with a
valid timestamp.

Or verify from PowerShell:

```powershell
Get-AuthenticodeSignature "release\<version>\i3X Explorer-Setup-<version>-win-x64.exe" |
    Select-Object Status, SignerCertificate
```

Expected output:
```
Status SignerCertificate
------ -----------------
 Valid [Subject: CN=<your org>, O=Microsoft Corporation, ...]
```

---

## Troubleshooting

| Symptom | Likely cause |
|---------|-------------|
| `AADSTS7000215: Invalid client secret` | Secret expired or wrong value copied, rotate in Entra portal |
| `AuthorizationFailed` | App registration not assigned the *Trusted Signing Certificate Profile Signer* role, see Step 4 |
| `signtool.exe not found` | Windows SDK not installed, see Prerequisites §1 |
| `signtool failed for …` | The signtool output follows the message; usually credentials or the role assignment (rows above) |
| `The parameter is incorrect` from signtool | Corrupt dlib cache, delete `scripts\.azure-signing\` and let the script re-download |
| `'0xEF' is an invalid start of a value` from signtool | `metadata.json` was written with a UTF-8 BOM; `prepare-win-signing.ps1` writes it without one, so make sure you're on the latest scripts |
| Build output says `skipping signing` | The signing variables weren't set; build with `build-sign-win.ps1`, not plain `electron-builder` |
| Installer is signed but Windows 11 blocks the installed app | The app exe was not signed before packaging, check the verify step's line for `win-unpacked\i3X Explorer.exe` |
| Signature shows as valid but SmartScreen still warns | Expected for a young signing identity or a new release; reputation builds as signed releases are downloaded and run. Submitting the release at Microsoft's file submission portal can help |
| `Cannot create symbolic link: A required privilege is not held` | Developer Mode is not enabled and script is not running as Administrator, see Prerequisites §4 |
| `magick: command not found` / icon not generated | ImageMagick not installed or not on PATH, see Prerequisites §3; open a new shell after installing |

---

## Rotating the Client Secret

1. Go to `Microsoft Entra ID` → `App registrations` → (your app) → `Certificates & secrets`
2. Create a **new** secret before deleting the old one
3. Update `scripts\set-azure-vars.ps1` with the new value
4. Delete the old secret
