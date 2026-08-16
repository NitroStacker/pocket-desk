param(
    [Parameter(Mandatory = $true)]
    [ValidateLength(2, 80)]
    [string]$Query
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$results = New-Object System.Collections.Generic.List[object]
$seen = @{}

function Add-SearchResult([string]$Path, [string]$Kind, $ModifiedAt) {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    if ($Path.StartsWith($env:APPDATA, [System.StringComparison]::OrdinalIgnoreCase)) { return }
    if ([System.IO.Path]::GetExtension($Path) -eq '.lnk') { return }

    $key = $Path.ToLowerInvariant()
    if ($seen.ContainsKey($key) -or $results.Count -ge 30) { return }
    $seen[$key] = $true
    $item = Get-Item -LiteralPath $Path -ErrorAction SilentlyContinue
    if ($null -eq $item) { return }

    $results.Add([PSCustomObject]@{
        name = $item.Name.Substring(0, [Math]::Min(180, $item.Name.Length))
        path = $item.FullName
        kind = if ([string]::IsNullOrWhiteSpace($Kind)) { $item.Extension.TrimStart('.').ToUpperInvariant() } else { $Kind }
        modifiedAt = if ($null -ne $ModifiedAt) { ([DateTime]$ModifiedAt).ToUniversalTime().ToString('o') } else { $item.LastWriteTimeUtc.ToString('o') }
    })
}

try {
    $escaped = $Query.Replace("'", "''").Replace('%', '[%]').Replace('_', '[_]')
    $profileUrl = ([System.Uri]$env:USERPROFILE).AbsoluteUri
    $sql = "SELECT TOP 50 System.ItemUrl, System.ItemTypeText, System.DateModified FROM SYSTEMINDEX WHERE SCOPE='$profileUrl' AND System.ItemName LIKE '%$escaped%' ORDER BY System.DateModified DESC"
    $connection = New-Object -ComObject ADODB.Connection
    $connection.Open("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")
    $recordset = New-Object -ComObject ADODB.Recordset
    $recordset.Open($sql, $connection)

    while (-not $recordset.EOF -and $results.Count -lt 30) {
        $itemUrl = [string]$recordset.Fields.Item('System.ItemUrl').Value
        $path = if ([string]::IsNullOrWhiteSpace($itemUrl)) { '' } else { ([System.Uri]$itemUrl).LocalPath }
        Add-SearchResult $path ([string]$recordset.Fields.Item('System.ItemTypeText').Value) $recordset.Fields.Item('System.DateModified').Value
        $recordset.MoveNext()
    }
    $recordset.Close()
    $connection.Close()
}
catch {
    $roots = @(
        [Environment]::GetFolderPath('Desktop'),
        [Environment]::GetFolderPath('MyDocuments'),
        (Join-Path $env:USERPROFILE 'Downloads')
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path -LiteralPath $_) }

    foreach ($root in $roots) {
        if ($results.Count -ge 30) { break }
        Get-ChildItem -LiteralPath $root -File -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.Name.IndexOf($Query, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 } |
            Select-Object -First (30 - $results.Count) |
            ForEach-Object { Add-SearchResult $_.FullName $_.Extension.TrimStart('.').ToUpperInvariant() $_.LastWriteTimeUtc }
    }
}

$results.ToArray() | ConvertTo-Json -Depth 4 -Compress
