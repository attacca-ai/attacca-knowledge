; ── Attacca NSIS Installer Customization ─────────────────────────────────────
; Included by electron-builder before MUI2.nsh.
; Only safe color/text defines that don't conflict with electron-builder.

; Brand colors (dark navy theme)
!define MUI_BGCOLOR "0A0E27"
!define MUI_TEXTCOLOR "F5F5FF"

; Abort warning
!define MUI_ABORTWARNING

; Branding text at bottom of installer
BrandingText "AttaccaClaw — AI Productivity Assistant"
