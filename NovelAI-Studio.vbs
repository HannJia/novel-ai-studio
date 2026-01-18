Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptPath = fso.GetParentFolderName(WScript.ScriptFullName)
batFile = scriptPath & "\start-app.bat"
If fso.FileExists(batFile) Then
  WshShell.CurrentDirectory = scriptPath
  WshShell.Run "cmd /c """ & batFile & """", 1, False
Else
  MsgBox "File not found: " & batFile, 16, "Error"
End If
