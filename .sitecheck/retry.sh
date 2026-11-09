#!/bin/bash
d="$1"; UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
if ! host -W 5 "$d" >/dev/null 2>&1 && ! host -W 5 "www.$d" >/dev/null 2>&1; then echo "$d|DNS|no DNS record"; exit; fi
for u in "https://$d" "https://www.$d" "http://$d" "http://www.$d"; do
  out=$(curl -sSL -m 25 -A "$UA" -o "html/$d.html" -w "%{http_code}|%{url_effective}" "$u" 2>&1)
  c=${out%%|*}
  if [[ "$c" =~ ^[0-9]{3}$ && "$c" != "000" ]]; then echo "$d|$out"; exit; fi
  err="$out"
done
echo "$d|ERR|$(echo "$err" | tr '\n' ' ' | cut -c1-120)"
