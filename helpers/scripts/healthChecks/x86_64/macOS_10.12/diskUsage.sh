#!/bin/bash -e
df / | awk '{print $5}' | sed '1d;s/^ //;s/%//'
