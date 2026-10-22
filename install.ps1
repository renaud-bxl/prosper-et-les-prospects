# Prosper et les prospects - installation Windows interactive, sans elevation.
# Aucun emplacement n'est cree avant l'apercu et la confirmation explicite.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Read-ProsperInput {
    param([Parameter(Mandatory = $true)][string]$Prompt)
    $answer = Read-Host -Prompt $Prompt
    if ($null -eq $answer -or [string]::IsNullOrWhiteSpace($answer)) {
        throw 'Installation annulee : aucune reponse recue.'
    }
    return [string]$answer
}

function Test-ProsperConfirmation {
    param([AllowNull()][AllowEmptyString()][string]$Answer)
    return ($null -ne $Answer -and $Answer.Trim().ToUpperInvariant() -ceq 'INSTALLER')
}

function Get-ProsperTools {
    $gitCommand = Get-Command git -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $nodeCommand = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
    # npm.cmd est le lanceur officiel Windows ; aucun changement de politique PowerShell.
    $npmCommand = Get-Command npm.cmd -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $nodeOutput = & $nodeCommand.Source --version
    if ($LASTEXITCODE -ne 0) { throw 'Node.js ne repond pas correctement.' }
    $nodeText = ([string]$nodeOutput).Trim()
    if ($nodeText -notmatch '^v([0-9]+)\.([0-9]+)\.([0-9]+)$') { throw 'Version de Node.js non reconnue.' }
    $nodeVersion = [Version]::new([int]$Matches[1], [int]$Matches[2], [int]$Matches[3])
    if ($nodeVersion -lt [Version]'22.13.0') {
        throw 'Node.js 22.13 ou plus recent est necessaire. Installez une version LTS, puis relancez.'
    }
    $gitVersion = & $gitCommand.Source --version
    if ($LASTEXITCODE -ne 0) { throw 'Git ne repond pas correctement.' }
    $npmVersion = & $npmCommand.Source --version
    if ($LASTEXITCODE -ne 0) { throw 'npm ne repond pas correctement.' }
    Write-Host ("Node.js {0} - {1} - npm {2}" -f $nodeText, ([string]$gitVersion).Trim(), ([string]$npmVersion).Trim())
    return @{ Git = $gitCommand.Source; Node = $nodeCommand.Source; Npm = $npmCommand.Source }
}

function Resolve-ProsperDestination {
    param([Parameter(Mandatory = $true)][string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { throw 'Le chemin cible est vide.' }
    if ($Path -match '\p{Cc}') { throw 'Le chemin contient un caractere de controle interdit.' }
    # Chemins absolus de disque ou partage UNC. Pas de chemin relatif, de peripherique ou d'expansion implicite.
    if ($Path -notmatch '^[A-Za-z]:[\\/]' -and $Path -notmatch '^\\\\(?![?.](?:\\|$))[^\\/]+\\[^\\/]+(?:\\.*)?$') {
        throw 'Indiquez un chemin Windows absolu, par exemple D:\Mes applications\Prosper.'
    }
    if ($Path.IndexOfAny([char[]]'<>"|?*') -ge 0) { throw 'Le chemin contient un caractere Windows interdit.' }
    $full = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetPathRoot($full)
    if ($full.TrimEnd('\', '/') -eq $root.TrimEnd('\', '/')) { throw 'Choisissez un dossier, pas la racine du disque ou du partage.' }
    foreach ($part in $full.Substring($root.Length).Split([char[]]'\/')) {
        if ($part -match '[. ]$' -or $part -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)' -or $part.Contains(':')) {
            throw 'Le chemin contient un nom de dossier reserve ou ambigu sous Windows.'
        }
    }
    return $full.TrimEnd('\', '/')
}

function Get-ProsperExistingItem {
    param([Parameter(Mandatory = $true)][string]$Path)
    try { return Get-Item -LiteralPath $Path -Force -ErrorAction Stop }
    catch [System.Management.Automation.ItemNotFoundException] { return $null }
}

function Assert-ProsperDestination {
    param([Parameter(Mandatory = $true)][string]$Path)
    $cursor = $Path
    while ($cursor) {
        $item = Get-ProsperExistingItem $cursor
        if ($null -ne $item) {
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'Le chemin cible ou un dossier parent est un lien ou une jonction. Choisissez un emplacement direct.'
            }
            if (-not $item.PSIsContainer) { throw 'Le chemin cible ou un dossier parent est un fichier.' }
        }
        $parent = [IO.Directory]::GetParent($cursor)
        if ($null -eq $parent) { break }
        $cursor = $parent.FullName
    }
    $target = Get-ProsperExistingItem $Path
    if ($null -ne $target -and $null -ne (Get-ChildItem -LiteralPath $Path -Force -ErrorAction Stop | Select-Object -First 1)) {
        throw 'Le dossier cible contient deja des fichiers. Rien ne sera ecrase : choisissez un dossier vide ou nouveau.'
    }
}

function Start-ProsperInstaller {
    if ($env:OS -ne 'Windows_NT') { throw 'Ce programme est reserve a Windows.' }
    if (-not [Environment]::UserInteractive -or [Console]::IsInputRedirected) {
        throw 'Une console interactive est necessaire. Aucune installation ne sera lancee depuis une entree redirigee.'
    }
    Write-Host ''
    Write-Host 'Prosper et les prospects - installation Windows'
    Write-Host 'Verification de Git, Node.js et npm avant toute creation de dossier...'
    $tools = Get-ProsperTools

    $choices = New-Object 'System.Collections.Generic.List[object]'
    $documents = [Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments)
    if (-not [string]::IsNullOrWhiteSpace($documents)) {
        $choices.Add([pscustomobject]@{ Label = "Documents ($documents)"; Path = (Join-Path $documents 'Prosper et les prospects'); Custom = $false })
    }
    foreach ($drive in @(Get-PSDrive -PSProvider FileSystem | Sort-Object Name)) {
        if ([string]::IsNullOrWhiteSpace($drive.Root)) { continue }
        $volumeLabel = ''
        try {
            $volume = [IO.DriveInfo]::new($drive.Root)
            if ($volume.IsReady) { $volumeLabel = [string]$volume.VolumeLabel }
        } catch { $volumeLabel = '' }
        $diskName = "Disque $($drive.Name)"
        if (-not [string]::IsNullOrWhiteSpace($volumeLabel)) { $diskName += " - $volumeLabel" }
        $choices.Add([pscustomobject]@{ Label = "$diskName ($($drive.Root))"; Path = (Join-Path $drive.Root 'Prosper et les prospects'); Custom = $false })
    }
    $choices.Add([pscustomobject]@{ Label = 'Chemin personnalise exact (aucun sous-dossier ne sera ajoute)'; Path = ''; Custom = $true })
    Write-Host ''
    Write-Host 'Ou installer Prosper ?'
    for ($index = 0; $index -lt $choices.Count; $index++) { Write-Host ("{0}. {1}" -f ($index + 1), $choices[$index].Label) }
    $selection = Read-ProsperInput 'Numero de votre choix (toute autre reponse annule)'
    $number = 0
    if (-not [int]::TryParse($selection.Trim(), [ref]$number) -or $number -lt 1 -or $number -gt $choices.Count) {
        throw 'Choix invalide : installation annulee.'
    }
    $chosen = $choices[$number - 1]
    if ($chosen.Custom) { $destination = Read-ProsperInput 'Chemin cible exact, sans guillemets' }
    else { $destination = $chosen.Path }
    $destination = Resolve-ProsperDestination $destination
    Assert-ProsperDestination $destination
    Write-Host ''
    Write-Host 'Apercu - aucun fichier de votre ordinateur ne sera remplace.'
    Write-Host "Dossier cible : $destination"
    Write-Host 'Depot : https://github.com/renaud-bxl/prosper-et-les-prospects.git'
    Write-Host 'Branche : main'
    Write-Host 'Etapes : telechargement, dependances npm, construction, ouverture de Prosper.'
    Write-Host 'Aucune cle API ni aucun droit administrateur ne sont demandes.'
    if (-not (Test-ProsperConfirmation (Read-ProsperInput 'Tapez INSTALLER pour confirmer ; toute autre reponse annule'))) {
        throw 'Installation annulee. Aucun dossier ni telechargement cree.'
    }

    # Revalidation apres la confirmation : un changement intervenu pendant la lecture ne doit rien ecraser.
    Assert-ProsperDestination $destination
    $parent = [IO.Directory]::GetParent($destination)
    [void][IO.Directory]::CreateDirectory($parent.FullName)
    Assert-ProsperDestination $destination
    & $tools.Git clone --branch main --single-branch -- 'https://github.com/renaud-bxl/prosper-et-les-prospects.git' $destination
    if ($LASTEXITCODE -ne 0) { throw 'Le telechargement a echoue. Les fichiers deja crees sont conserves pour verification.' }
    Push-Location -LiteralPath $destination
    try {
        & $tools.Npm ci
        if ($LASTEXITCODE -ne 0) { throw 'Installation des dependances interrompue. Le dossier est conserve.' }
        & $tools.Npm run build
        if ($LASTEXITCODE -ne 0) { throw 'La construction a echoue. Le dossier est conserve.' }
        Write-Host ''
        Write-Host "Installation terminee dans : $destination"
        Write-Host 'Prosper va ouvrir votre navigateur. Gardez cette fenetre ouverte pendant son utilisation.'
        & $tools.Npm start
        if ($LASTEXITCODE -ne 0) { throw 'Prosper a quitte avec une erreur. Le dossier est conserve.' }
    } finally { Pop-Location }
}

# Dot-sourcing disponible pour verifier les fonctions sans executer l'installation.
# Aucune dependance a PSScriptRoot : la destination est toujours celle confirmee par la personne.
if ($MyInvocation.InvocationName -ne '.') {
    try { Start-ProsperInstaller }
    catch {
        Write-Host ''
        Write-Host ("Installation non terminee : {0}" -f $_.Exception.Message) -ForegroundColor Red
        exit 1
    }
}
