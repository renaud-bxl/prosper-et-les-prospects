#!/bin/sh
# Prosper et les prospects — macOS/Linux, without administrator access.
set -eu
umask 077

prosper_fail() { printf '\nInstallation interrompue : %s\n' "$*" >&2; exit 1; }
prosper_target=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir) [ "$#" -ge 2 ] || prosper_fail 'Précisez un chemin absolu après --dir.'; prosper_target=$2; shift 2 ;;
    --dir=*) prosper_target=${1#*=}; shift ;;
    --help|-h) printf '%s\n' 'Prosper et les prospects — sh install.sh [--dir /chemin/absolu]' 'Sans --dir, choisissez Documents, un disque monté ou un dossier personnalisé.' 'Une confirmation interactive précède toute création et tout téléchargement du projet.'; exit 0 ;;
    *) prosper_fail "Option inconnue : $1" ;;
  esac
done

case "$(uname -s)" in Darwin) prosper_system=darwin ;; Linux) prosper_system=linux ;; *) prosper_fail 'Utilisez install.ps1 sur Windows. Cet installateur est réservé à macOS et Linux.' ;; esac
for prosper_tool in node npm git; do command -v "$prosper_tool" >/dev/null 2>&1 || prosper_fail "$prosper_tool manque. Installez Node.js 22.13 ou plus récent et Git, puis relancez."; done
prosper_version=$(node -p 'process.versions.node' 2>/dev/null) || prosper_fail 'Node.js ne peut pas démarrer.'
case "$prosper_version" in ''|*[!0-9.]*|.*|*..*|*.) prosper_fail 'Version Node.js non reconnue. Node.js 22.13 ou plus récent est requis.' ;; esac
prosper_major=${prosper_version%%.*}
prosper_rest=${prosper_version#*.}
prosper_minor=${prosper_rest%%.*}
if ! { [ "$prosper_major" -gt 22 ] || { [ "$prosper_major" -eq 22 ] && [ "$prosper_minor" -ge 13 ]; }; }; then prosper_fail "Node.js $prosper_version est trop ancien. Version minimale : 22.13."; fi
git --version >/dev/null 2>&1 || prosper_fail 'Git ne peut pas démarrer. Vérifiez son installation puis relancez.'
npm --version >/dev/null 2>&1 || prosper_fail 'npm ne peut pas démarrer. Vérifiez votre installation Node.js puis relancez.'

# Read from the terminal rather than the script pipe (curl | sh).
# The explicit test hook is only for isolated fixture tests, never needed to install.
if [ "${PROSPER_INSTALL_TESTING:-}" = 1 ] && [ -n "${PROSPER_INSTALL_TEST_INPUT:-}" ]; then
  exec 3<"$PROSPER_INSTALL_TEST_INPUT"
elif [ -t 0 ]; then
  exec 3<&0
elif ( : </dev/tty ) 2>/dev/null; then
  exec 3</dev/tty
else
  prosper_fail 'Aucun terminal interactif. Ouvrez Terminal et relancez la commande. Aucun fichier du projet n’a été installé.'
fi
prosper_ask() { printf '%s' "$1" >&2; IFS= read -r prosper_answer <&3 || prosper_fail 'Réponse interrompue. Aucun nouvel emplacement n’a été accepté.'; }
prosper_safe_text() { if printf '%s' "$1" | LC_ALL=C grep -q '[[:cntrl:]]'; then prosper_fail 'Le chemin contient un caractère de contrôle.'; fi; }
prosper_device() { if [ "$prosper_system" = darwin ]; then stat -f %d "$1" 2>/dev/null; else stat -c %d "$1" 2>/dev/null; fi; }
prosper_mount=''
prosper_mount_device=''
prosper_index=1
prosper_choices=''
prosper_offer_disk() {
  [ -d "$prosper_disk" ] && [ ! -L "$prosper_disk" ] && [ -w "$prosper_disk" ] || return 0
  if printf '%s' "$prosper_disk" | LC_ALL=C grep -q '[[:cntrl:]]'; then return 0; fi
  prosper_device_id=$(prosper_device "$prosper_disk") || return 0
  prosper_parent_device=$(prosper_device "$(dirname "$prosper_disk")") || return 0
  [ "$prosper_device_id" != "$prosper_parent_device" ] || return 0
  prosper_index=$((prosper_index + 1))
  printf '  %s. %s — %s\n' "$prosper_index" "$(basename "$prosper_disk")" "$prosper_disk"
  prosper_choices="${prosper_choices}${prosper_index}$(printf '\t')${prosper_device_id}$(printf '\t')${prosper_disk}
"
}

if [ -z "$prosper_target" ]; then
  [ -n "${HOME:-}" ] || prosper_fail 'Dossier personnel introuvable. Utilisez --dir.'
  prosper_safe_text "$HOME"
  printf '\n%s\n%s\n' 'Où installer Prosper et les prospects ?' 'Le logiciel, les réglages et les missions resteront dans le dossier choisi.'
  printf '  1. Documents de cet ordinateur — %s/Documents/Prosper et les prospects\n' "$HOME"
  if [ "${PROSPER_INSTALL_TESTING:-}" = 1 ] && [ -n "${PROSPER_INSTALL_TEST_MOUNTS:-}" ]; then
    for prosper_disk in "$PROSPER_INSTALL_TEST_MOUNTS"/*; do prosper_offer_disk; done
  elif [ "$prosper_system" = darwin ]; then
    for prosper_disk in /Volumes/*; do prosper_offer_disk; done
  else
    for prosper_disk in /media/* /media/*/* /run/media/*/* /mnt /mnt/*; do prosper_offer_disk; done
  fi
  prosper_custom=$((prosper_index + 1))
  printf '  %s. Choisir un chemin personnalisé\n' "$prosper_custom"
  printf '%s\n' 'Si un disque manque, branchez-le et montez-le avant de relancer.'
  prosper_ask 'Votre choix [1] : '
  [ -n "$prosper_answer" ] || prosper_answer=1
  case "$prosper_answer" in *[!0-9]*|0) prosper_fail 'Choisissez un numéro de la liste.' ;; esac
  if [ "$prosper_answer" = 1 ]; then
    prosper_target="$HOME/Documents/Prosper et les prospects"
  elif [ "$prosper_answer" = "$prosper_custom" ]; then
    prosper_ask 'Chemin absolu du dossier exact à créer pour Prosper : '
    prosper_target=$prosper_answer
  else
    while IFS="$(printf '\t')" read -r prosper_choice prosper_choice_device prosper_choice_disk; do
      [ -n "$prosper_choice_disk" ] || continue
      if [ "$prosper_answer" = "$prosper_choice" ]; then
        prosper_mount=$prosper_choice_disk
        prosper_mount_device=$prosper_choice_device
        prosper_target="$prosper_mount/Prosper et les prospects"
      fi
    done <<PROSPER_DISKS
$prosper_choices
PROSPER_DISKS
    [ -n "$prosper_target" ] || prosper_fail 'Emplacement inconnu.'
  fi
fi

prosper_safe_text "$prosper_target"
while [ "$prosper_target" != / ] && [ "${prosper_target%/}" != "$prosper_target" ]; do prosper_target=${prosper_target%/}; done
case "$prosper_target" in /*) ;; *) prosper_fail 'Le dossier doit être un chemin absolu, commençant par /.' ;; esac
case "$prosper_target/" in *'/../'*|*'/./'*|*'//'*) prosper_fail 'Le chemin ne peut contenir ni . ni .. ni double barre oblique.' ;; esac
case "$prosper_target" in
  /|/Users|/Volumes|/home|/media|/mnt|/run/media|/tmp|/private|/private/tmp|/var|/private/var|/opt|"${HOME:-/}"|"${HOME:-/}/Documents") prosper_fail 'Choisissez un sous-dossier réservé à Prosper.' ;;
  /System|/System/*|/Library|/Library/*|/Applications|/Applications/*|/usr|/usr/*|/bin|/bin/*|/sbin|/sbin/*|/etc|/etc/*|/dev|/dev/*|/proc|/proc/*|/sys|/sys/*|/root|/root/*) prosper_fail 'Choisissez un dossier personnel, sans privilèges administrateur.' ;;
esac
prosper_check_target() {
  prosper_parent=$prosper_target
  while [ "$prosper_parent" != / ]; do
    [ ! -L "$prosper_parent" ] || prosper_fail 'Le chemin ou un de ses parents est un lien symbolique. Choisissez son chemin réel.'
    [ ! -e "$prosper_parent" ] || [ -d "$prosper_parent" ] || prosper_fail 'Un fichier occupe le chemin choisi.'
    prosper_parent=$(dirname "$prosper_parent")
  done
  if [ -d "$prosper_target" ]; then
    for prosper_entry in "$prosper_target"/* "$prosper_target"/.[!.]* "$prosper_target"/..?*; do
      if [ -e "$prosper_entry" ] || [ -L "$prosper_entry" ]; then prosper_fail 'Le dossier choisi contient déjà des fichiers. Rien ne sera remplacé. Choisissez un dossier vide ou relancez votre installation existante.'; fi
    done
  fi
}
# For custom paths under known external-volume roots, never recreate an absent disk.
if [ -z "$prosper_mount" ]; then
  case "$prosper_target" in
    /Volumes/*) [ "$prosper_system" != darwin ] || { prosper_tail=${prosper_target#/Volumes/}; prosper_mount="/Volumes/${prosper_tail%%/*}"; } ;;
    /media/*|/mnt/*|/run/media/*)
      if [ "$prosper_system" = linux ]; then
        prosper_mount=$(dirname "$prosper_target")
        while [ "$prosper_mount" != / ]; do
          if [ -d "$prosper_mount" ]; then
            prosper_now_device=$(prosper_device "$prosper_mount") || prosper_now_device=''
            prosper_outer_device=$(prosper_device "$(dirname "$prosper_mount")") || prosper_outer_device=''
            if [ -n "$prosper_now_device" ] && [ "$prosper_now_device" != "$prosper_outer_device" ]; then break; fi
          fi
          prosper_mount=$(dirname "$prosper_mount")
        done
        [ "$prosper_mount" != / ] || prosper_fail 'Le disque demandé n’est pas monté. Aucun dossier de remplacement ne sera créé.'
      fi ;;
  esac
fi
prosper_check_mount() {
  [ -n "$prosper_mount" ] || return 0
  [ -d "$prosper_mount" ] && [ ! -L "$prosper_mount" ] || prosper_fail 'Le disque choisi n’est plus monté.'
  prosper_current_device=$(prosper_device "$prosper_mount") || prosper_fail 'Le disque choisi est inaccessible.'
  prosper_outer_device=$(prosper_device "$(dirname "$prosper_mount")") || prosper_fail 'Le disque choisi est inaccessible.'
  [ "$prosper_current_device" != "$prosper_outer_device" ] || prosper_fail 'Le disque choisi n’est plus monté.'
  [ -z "$prosper_mount_device" ] || [ "$prosper_current_device" = "$prosper_mount_device" ] || prosper_fail 'Le disque choisi a changé. Relancez l’installation.'
  prosper_mount_device=$prosper_current_device
  [ "$prosper_target" != "$prosper_mount" ] || prosper_fail 'Choisissez un sous-dossier du disque.'
}
prosper_check_target
prosper_check_mount
prosper_existing=0
[ ! -d "$prosper_target" ] || prosper_existing=1
printf '\n%s\n  %s\n\n%s\n%s\n' 'Dossier exact de Prosper :' "$prosper_target" 'Le code sera téléchargé depuis GitHub (branche main), puis les dépendances installées.' 'Les missions, config.json et données resteront dans ce dossier. Aucun ancien dossier ne sera déplacé.'
prosper_ask 'Créer ce dossier, télécharger et lancer Prosper ? [o/N] : '
case "$prosper_answer" in o|O|oui|Oui|OUI|y|Y|yes|YES) ;; *) printf '%s\n' 'Installation annulée. Aucun fichier du projet n’a été installé.'; exit 0 ;; esac
prosper_check_target
prosper_check_mount
if [ "$prosper_existing" -eq 0 ]; then
  mkdir -p "$(dirname "$prosper_target")" || prosper_fail 'Impossible de créer le dossier parent.'
  prosper_check_target
  mkdir "$prosper_target" || prosper_fail 'Le dossier est apparu ou ne peut être créé. Rien ne sera écrasé.'
fi
printf '\n%s\n' 'Téléchargement de Prosper…'
git clone --branch main --single-branch -- https://github.com/renaud-bxl/prosper-et-les-prospects.git "$prosper_target" || prosper_fail "Téléchargement incomplet. Le dossier est conservé pour inspection : $prosper_target"
cd "$prosper_target" || prosper_fail 'Impossible d’ouvrir le dossier installé.'
npm ci || prosper_fail "Installation des dépendances interrompue. Le dossier est conservé : $prosper_target"
npm run build || prosper_fail "Construction interrompue. Le dossier est conservé : $prosper_target"
printf '\nDossier installé : %s\nPour les prochains lancements : npm start depuis ce dossier.\n\n' "$prosper_target"
exec npm start
