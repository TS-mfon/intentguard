import type {NextConfig} from "next";
const exported=process.env.INTENTGUARD_STATIC_EXPORT==="1";
const config:NextConfig={
 output:exported?"export":"standalone",
 poweredByHeader:false,
 ...(exported?{trailingSlash:true,images:{unoptimized:true}}:{outputFileTracingIncludes:{"/api/**":["../../contracts/genlayer/**/*.py"]}}),
};
export default config;
