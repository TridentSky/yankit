Set FSO = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")

strFolder = FSO.GetParentFolderName(WScript.ScriptFullName)
strElectron = FSO.BuildPath(strFolder, "node_modules\electron\dist\electron.exe")

If Not FSO.FileExists(strElectron) Then
    If Not FSO.FolderExists(FSO.BuildPath(strFolder, "node_modules")) Then
        WshShell.Popup "Setting up Yankit Downloader for the first time." & vbCrLf & "This may take a minute.", 5, "Yankit Downloader", 64
        WshShell.Run "cmd /c cd /d """ & strFolder & """ && npm install", 1, True
    End If
End If

If Not FSO.FileExists(strElectron) Then
    MsgBox "Setup failed. Make sure Node.js is installed." & vbCrLf & vbCrLf & "Download from https://nodejs.org", vbCritical, "Yankit Downloader"
    WScript.Quit
End If

WshShell.Run "cmd /c cd /d """ & strFolder & """ && set ELECTRON_RUN_AS_NODE= && """ & strElectron & """ .", 0, False
