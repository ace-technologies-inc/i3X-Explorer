# verify-win-signing.ps1
# Fails unless everything a Windows build ships is validly signed:
#
#   .\scripts\verify-win-signing.ps1 -ReleaseDir release\1.2.3
#
# Checks:
#   - every installer / portable .exe, and every .exe in each *-unpacked folder
#     (the same files that were packed into the installers): signed by US (the same
#     subject as the app exe) and timestamped. Trusted Signing certificates live about
#     3 days, so an untimestamped signature would expire with its certificate.
#   - every .dll in each *-unpacked folder: validly signed by anyone. Electron ships some
#     Microsoft-signed DLLs that the build deliberately leaves alone (see winSign.cjs).
#
# Used by build-sign-win.ps1 and .github/workflows/build-win.yml.

param([Parameter(Mandatory)][string]$ReleaseDir)

$ErrorActionPreference = 'Stop'
$ReleaseDir = (Resolve-Path $ReleaseDir).Path

$all = @(Get-ChildItem -Path $ReleaseDir -Recurse -File -Include '*.exe', '*.dll')
$isUnpacked = { param($f) $f.FullName -match '\\[^\\]*-unpacked\\' }

$installers = @($all | Where-Object { $_.Extension -eq '.exe' -and -not (& $isUnpacked $_) })
$appExes    = @($all | Where-Object { $_.Extension -eq '.exe' -and (& $isUnpacked $_) })
$appDlls    = @($all | Where-Object { $_.Extension -eq '.dll' -and (& $isUnpacked $_) })
$mainExes   = @($appExes | Where-Object { $_.Name -eq 'i3X Explorer.exe' })

if ($installers.Count -eq 0) { throw "No installer .exe files found in $ReleaseDir" }
if ($mainExes.Count -eq 0)   { throw "No unpacked 'i3X Explorer.exe' under $ReleaseDir; cannot verify the app itself" }

$ourSig = Get-AuthenticodeSignature -FilePath $mainExes[0].FullName
if ($ourSig.Status -ne 'Valid') {
    throw "$($mainExes[0].FullName) is not validly signed: $($ourSig.Status) $($ourSig.StatusMessage)"
}
$ourSubject = $ourSig.SignerCertificate.Subject
Write-Host "  Expected signer: $ourSubject"

$bad = 0
function Check($file, [bool]$mustBeOurs) {
    $label = $file.FullName.Substring($ReleaseDir.Length + 1)
    $sig   = Get-AuthenticodeSignature -FilePath $file.FullName
    $why   = $null
    if ($sig.Status -ne 'Valid') {
        $why = "$($sig.Status): $($sig.StatusMessage)"
    } elseif ($mustBeOurs -and $sig.SignerCertificate.Subject -ne $ourSubject) {
        $why = "signed by $($sig.SignerCertificate.Subject), not by us"
    } elseif ($sig.SignerCertificate.Subject -eq $ourSubject -and -not $sig.TimeStamperCertificate) {
        $why = "signed but NOT timestamped"
    }
    if ($why) {
        Write-Host "  [XX]  $label  ·  $why" -ForegroundColor Red
        $script:bad++
    } else {
        $who = if ($sig.SignerCertificate.Subject -eq $ourSubject) { 'ours' } else { ($sig.SignerCertificate.Subject -split ',')[0] }
        Write-Host "  [OK]  $label  ·  $who" -ForegroundColor Green
    }
}

foreach ($f in $installers + $appExes) { Check $f $true }
foreach ($f in $appDlls)               { Check $f $false }

if ($bad -gt 0) { throw "$bad file(s) failed signature verification; do NOT distribute this build" }
Write-Host "  All $($installers.Count + $appExes.Count + $appDlls.Count) files validly signed."
