#!/bin/bash
UA="Mozilla/5.0 (compatible; SiteCheckerResearch/1.0)"
n=0
while read -r url; do
  slug=$(echo "$url" | sed 's|https://sitechecker.pro/site-audit-issues/||; s|/$||; s|/|_|g')
  [ -z "$slug" ] && continue
  out="research/issues/$slug.html"
  if [ -s "$out" ]; then continue; fi
  curl -sL --max-time 30 -A "$UA" "$url" -o "$out" &
  n=$((n+1))
  if [ $((n % 6)) -eq 0 ]; then wait; fi
done < research/issue_urls.txt
wait
echo "downloaded: $(ls research/issues/*.html 2>/dev/null | wc -l)"
