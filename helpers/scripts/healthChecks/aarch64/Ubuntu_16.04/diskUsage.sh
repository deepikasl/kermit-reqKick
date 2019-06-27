#!/bin/bash -e
df --output=pcent / | sed '1d;s/^ //;s/%//'
