$ErrorActionPreference = "Stop"
docker images -q | Sort-Object -unique | Measure-Object -line |  %{ $_.Lines }
