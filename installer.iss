#define MyAppName "Queu Uninstaller"
#define MyAppVersion "1.5.3"
#define MyAppPublisher "Queu Uninstaller"
#define MyAppURL "https://github.com/ivoovieira/queue-uninstaller"
#define MyAppExeName "QueuUninstaller.exe"

[Setup]
AppId={{8B13F10A-3C6D-4F1D-8919-450F2C41D3B8}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
ArchitecturesInstallIn64BitMode=x64
ArchitecturesAllowed=x64
DefaultDirName={autopf}\{#MyAppName}
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=commandline
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
OutputDir=dist\installer
OutputBaseFilename=QueuUninstaller-Setup-v{#MyAppVersion}
SetupIconFile=icon.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName}
CloseApplications=force
CloseApplicationsFilter=QueuUninstaller.exe

[Code]
function InitializeSetup(): Boolean;
var
  ErrorCode: Integer;
  LegacyPath: String;
  LegacyLnk: String;
  LegacyDesktopLnk: String;
begin
  Exec('taskkill.exe', '/F /IM QueuUninstaller.exe', '', SW_HIDE, ewWaitUntilTerminated, ErrorCode);

  LegacyPath := ExpandConstant('{localappdata}\Programs\Queu Uninstaller');
  if DirExists(LegacyPath) then
  begin
    LegacyLnk := ExpandConstant('{userprograms}\Queu Uninstaller.lnk');
    if FileExists(LegacyLnk) then
      DeleteFile(LegacyLnk);

    LegacyDesktopLnk := ExpandConstant('{userdesktop}\Queu Uninstaller.lnk');
    if FileExists(LegacyDesktopLnk) then
      DeleteFile(LegacyDesktopLnk);

    DelTree(LegacyPath, True, True, True);
    RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{8B13F10A-3C6D-4F1D-8919-450F2C41D3B8}_is1');
  end;

  Result := True;
end;

procedure SetRunAsAdmin(const Filename: String);
var
  ErrorCode: Integer;
begin
  if FileExists(Filename) then
  begin
    Exec('powershell.exe', '-NoProfile -WindowStyle Hidden -Command "$p=''' + Filename + '''; if (Test-Path $p) { $b = [System.IO.File]::ReadAllBytes($p); $b[0x15] = $b[0x15] -bor 0x20; [System.IO.File]::WriteAllBytes($p, $b) }"', '', SW_HIDE, ewWaitUntilTerminated, ErrorCode);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    SetRunAsAdmin(ExpandConstant('{autoprograms}\{#MyAppName}.lnk'));
    SetRunAsAdmin(ExpandConstant('{autodesktop}\{#MyAppName}.lnk'));
    SetRunAsAdmin(ExpandConstant('{userdesktop}\{#MyAppName}.lnk'));
    SetRunAsAdmin(ExpandConstant('{commondesktop}\{#MyAppName}.lnk'));
  end;
end;

[Registry]
Root: HKLM; Subkey: "Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers"; ValueType: string; ValueName: "{app}\{#MyAppExeName}"; ValueData: "~ RUNASADMIN"; Flags: uninsdeletevalue

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "dist\QueuUninstaller-win32-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent shellexec
