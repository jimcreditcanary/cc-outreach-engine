#!/bin/bash
d="$1"; UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
try(){ curl -sSL -m 20 -A "$UA" -o "html/$d.html" -w "%{http_code}|%{url_effective}" "$1" 2>/dev/null; }
r=$(try "https://$d"); c=${r%%|*}
if [ "$c" = "000" ]; then r=$(try "http://$d"); c=${r%%|*}; fi
if [ "$c" = "000" ]; then r=$(try "https://www.$d"); c=${r%%|*}; fi
echo "$d|$r"
