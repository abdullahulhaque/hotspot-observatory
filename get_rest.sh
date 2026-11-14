#!/usr/bin/env bash
COUNTRY="$1"
BASE="https://firms.modaps.eosdis.nasa.gov/data/country/zips"

fetch() {
  [ -d "$1/$2" ] && return
  f="${1}_${2}_all_countries.zip"
  curl -fL -C - -o "$f" "$BASE/$f" || { echo "FAILED $f"; return; }
  mkdir -p "$1/$2"
  unzip -j -o "$f" "*${COUNTRY}*" -d "$1/$2" && rm "$f"
}

y=2012
while [ $y -le 2025 ]; do
  fetch modis "$y"; fetch viirs-snpp "$y"
  y=$((y+1))
done
y=2003
while [ $y -le 2011 ]; do
  fetch modis "$y"
  y=$((y+1))
done
echo "DONE"
