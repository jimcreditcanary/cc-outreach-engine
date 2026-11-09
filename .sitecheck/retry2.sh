#!/bin/bash
d="$1"; UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
a=$(dig +short +time=3 "$d" A | grep -E '^[0-9.]+$' | head -1); w=$(dig +short +time=3 "www.$d" A | grep -E '^[0-9.]+$' | head -1)
if [ -z "$a$w" ]; then echo "$d|DNS|no A record"; exit; fi
for u in "https://$d" "https://www.$d" "http://$d" "http://www.$d"; do
  out=$(curl -sSL -m 15 -A "$UA" -o "html/$d.html" -w "%{http_code}|%{url_effective}" "$u" 2>&1)
  c=${out%%|*}
  if [[ "$c" =~ ^[0-9]{3}$ && "$c" != "000" ]]; then echo "$d|$out"; exit; fi
  err="$out"
done
echo "$d|ERR|$(echo "$err" | tr '\n' ' ' | cut -c1-100)"
