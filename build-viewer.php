<?php
/**
 * build-viewer.php - Converts sitemap files from a decompiled CHM (.hhc / .hhk)
 * into JavaScript data consumable by viewer/index.html.
 *
 * Usage:  php build-viewer.php [--src=.] [--hhp=php_manual_en.hhp]
 *
 * Output (in viewer/data/):
 *   toc.js    -> window.CHM_TOC   : contents tree       [name, href, children]
 *   index.js  -> window.CHM_INDEX : flat alpha index    [name, href]
 *   meta.js   -> window.CHM_META  : title, default page, counters
 *
 * They are emitted as .js (not .json) on purpose, so the viewer also works
 * when opened directly via file://, where fetch() is blocked by CORS.
 */

$opts = getopt('', ['src::', 'hhp::', 'out::']);
$src = rtrim($opts['src'] ?? __DIR__, '/');
$out = rtrim($opts['out'] ?? "$src/viewer", '/');

// ---------------------------------------------------------------- locate
$hhp = $opts['hhp'] ?? (glob("$src/*.hhp")[0] ?? null);
if (!$hhp || !is_file($hhp)) {
    fwrite(STDERR, "No .hhp was found in $src\n");
    exit(1);
}

$project = parse_hhp($hhp);
$hhc = resolve($src, $project['Contents file'] ?? null) ?? (glob("$src/*.hhc")[0] ?? null);
$hhk = resolve($src, $project['Index file'] ?? null) ?? (glob("$src/*.hhk")[0] ?? null);

printf("Project  : %s\n", basename($hhp));
printf("Title    : %s\n", $project['Title'] ?? '(no title)');
printf("TOC      : %s\n", $hhc ? basename($hhc) : '(none)');
printf("Index    : %s\n", $hhk ? basename($hhk) : '(none)');

// ---------------------------------------------------------------- parse
$toc = $hhc ? parse_sitemap_tree($hhc) : [];
$index = $hhk ? parse_sitemap_flat($hhk) : [];

$tocCount = count_nodes($toc);
printf("TOC nodes: %d\nIndex entries: %d\n", $tocCount, count($index));

// ---------------------------------------------------------------- write
@mkdir("$out/data", 0777, true);

$meta = [
    'title' => $project['Title'] ?? 'Help',
    'home' => normalize_href($project['Default topic'] ?? 'index.html'),
    'tocSize' => $tocCount,
    'idxSize' => count($index),
    'built' => date('c'),
];

write_js("$out/data/toc.js", 'CHM_TOC', $toc);
write_js("$out/data/index.js", 'CHM_INDEX', $index);
write_js("$out/data/meta.js", 'CHM_META', $meta);

echo "Done. Open $out/index.html\n";

// ================================================================ functions

/** Reads the [OPTIONS] section of a .hhp as key => value pairs. */
function parse_hhp(string $file): array
{
    $data = [];
    $in = false;
    foreach (file($file, FILE_IGNORE_NEW_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === ';')
            continue;
        if ($line[0] === '[') {
            $in = strcasecmp($line, '[OPTIONS]') === 0;
            continue;
        }
        if ($in && str_contains($line, '=')) {
            [$k, $v] = explode('=', $line, 2);
            $data[trim($k)] = trim($v);
        }
    }
    return $data;
}

function resolve(string $src, ?string $rel): ?string
{
    if (!$rel)
        return null;
    $path = "$src/" . str_replace('\\', '/', $rel);
    return is_file($path) ? $path : null;
}

/**
 * Tokenizes an HHC/HHK sitemap while preserving document order.
 *
 * In HHC format, nested <ul> blocks appear as SIBLINGS of the parent <li>,
 * not inside it, so a DOM parser yields a flat tree. That is why the file is
 * scanned linearly with an explicit stack: when a <ul> opens, the parent
 * becomes the last item emitted at the current level.
 */
function parse_sitemap_tree(string $file): array
{
    $html = read_text($file);

    $root = ['children' => []];
    $stack = [&$root];

    $re = '#<ul\b[^>]*>|</ul\s*>|<object\b[^>]*type\s*=\s*["\']?text/sitemap["\']?[^>]*>(.*?)</object\s*>#is';
    preg_match_all($re, $html, $m, PREG_SET_ORDER);

    foreach ($m as $tok) {
        $tag = strtolower(substr($tok[0], 0, 4));

        if ($tag === '<ul ' || $tag === '<ul>') {
            $top = &$stack[count($stack) - 1];
            $n = count($top['children']);
            if ($n === 0) {                     // <ul> with no previous <li>: bridge node
                $top['children'][] = ['n' => '', 'children' => []];
                $n = 1;
            }
            $stack[] = &$top['children'][$n - 1];
            unset($top);
            continue;
        }

        if ($tag === '</ul') {
            if (count($stack) > 1)
                array_pop($stack);
            continue;
        }

        $item = parse_object($tok[1] ?? '');
        if ($item === null)
            continue;           // "text/site properties" or empty object

        $top = &$stack[count($stack) - 1];
        $top['children'][] = $item;
        unset($top);
    }

    return unwrap(prune($root['children']));
}

/** .hhk is a flat list: just collect sitemap objects. */
function parse_sitemap_flat(string $file): array
{
    $html = read_text($file);
    preg_match_all(
        '#<object\b[^>]*type\s*=\s*["\']?text/sitemap["\']?[^>]*>(.*?)</object\s*>#is',
        $html,
        $m,
        PREG_SET_ORDER
    );

    $seen = $out = [];
    foreach ($m as $tok) {
        $item = parse_object($tok[1]);
        if ($item === null || $item['n'] === '')
            continue;
        $key = $item['n'] . "\0" . ($item['h'] ?? '');
        if (isset($seen[$key]))
            continue;       // .hhk contains duplicates
        $seen[$key] = true;
        $out[] = ['n' => $item['n'], 'h' => $item['h'] ?? ''];
    }

    usort($out, fn($a, $b) => strnatcasecmp($a['n'], $b['n']) ?: strcmp($a['h'], $b['h']));
    return $out;
}

/** Extracts <param name="Name"|"Local"> from a sitemap object. */
function parse_object(string $body): ?array
{
    preg_match_all(
        '#<param\b[^>]*name\s*=\s*["\']([^"\']*)["\'][^>]*value\s*=\s*["\']([^"\']*)["\']#i',
        $body,
        $p,
        PREG_SET_ORDER
    );

    $name = null;
    $local = null;
    foreach ($p as $param) {
        switch (strtolower($param[1])) {
            case 'name':
                $name ??= html_entity_decode($param[2], ENT_QUOTES | ENT_HTML5, 'UTF-8');
                break;
            case 'local':
                $local ??= normalize_href($param[2]);
                break;
            case 'merge':
                $local ??= normalize_href($param[2]);
                break;
        }
    }

    if ($name === null && $local === null)
        return null;

    $node = ['n' => trim((string) $name), 'children' => []];
    if ($local)
        $node['h'] = $local;
    return $node;
}

function normalize_href(string $href): string
{
    $href = str_replace('\\', '/', html_entity_decode(trim($href), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    return ltrim($href, '/');
}

/** Removes empty `children` and nameless/targetless nodes (HHC noise). */
function prune(array $nodes): array
{
    $out = [];
    foreach ($nodes as $node) {
        $kids = prune($node['children'] ?? []);
        if ($node['n'] === '' && !isset($node['h']) && !$kids)
            continue;
        if ($node['n'] === '' && !$kids && isset($node['h']))
            continue;  // orphan entry without title

        $clean = ['n' => $node['n']];
        if (isset($node['h']))
            $clean['h'] = $node['h'];
        if ($kids)
            $clean['c'] = $kids;
        $out[] = $clean;
    }
    return $out;
}

function count_nodes(array $nodes): int
{
    $n = 0;
    foreach ($nodes as $node)
        $n += 1 + count_nodes($node['c'] ?? []);
    return $n;
}

/** .hhc files are often windows-1252; the viewer serves UTF-8. */
function read_text(string $file): string
{
    $raw = file_get_contents($file);
    if (!mb_check_encoding($raw, 'UTF-8')) {
        $raw = mb_convert_encoding($raw, 'UTF-8', 'Windows-1252');
    }
    return $raw;
}

function write_js(string $path, string $global, mixed $data): void
{
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    file_put_contents($path, "window.$global=$json;\n");
    printf("  %-24s %s\n", basename($path), human(filesize($path)));
}

function human(int $bytes): string
{
    $u = ['B', 'KB', 'MB', 'GB'];
    $i = $bytes > 0 ? (int) floor(log($bytes, 1024)) : 0;
    return round($bytes / 1024 ** $i, 1) . ' ' . $u[$i];
}

/**
 * PhD-generated HHC opens its first <ul> without a previous <li>, so the parser
 * creates an anonymous bridge node that wraps the whole manual. It is dropped so
 * the tree starts directly at the first real chapter.
 */
function unwrap(array $nodes): array
{
    while (count($nodes) === 1 && $nodes[0]['n'] === '' && !empty($nodes[0]['c'])) {
        $nodes = $nodes[0]['c'];
    }
    return $nodes;
}