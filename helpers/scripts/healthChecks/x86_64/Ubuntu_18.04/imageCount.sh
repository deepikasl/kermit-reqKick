#!/bin/bash -e
docker images -q | sort -u | wc -l
