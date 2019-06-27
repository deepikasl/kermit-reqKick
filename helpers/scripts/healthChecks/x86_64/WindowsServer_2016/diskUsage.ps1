$ErrorActionPreference = "Stop"
$driveC = Get-PSDrive C

[math]::Round($driveC.Used * 100 / ($driveC.Free + $driveC.Used))
