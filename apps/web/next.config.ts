import type { NextConfig } from "next";
const config:NextConfig={
 output:"standalone",
 poweredByHeader:false,
 outputFileTracingIncludes:{"/api/**":["../../contracts/genlayer/**/*.py"]},
};
export default config;
