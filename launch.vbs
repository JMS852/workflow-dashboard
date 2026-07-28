Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

projectDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Kill existing instances
WshShell.Run "cmd /c taskkill /F /IM electron.exe 2>nul & exit 0", 0, True
WScript.Sleep 500

' Build and launch
WshShell.Run "cmd /c cd /d """ & projectDir & """ && node launcher.js", 0, False
