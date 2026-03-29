import type { AppProps } from "next/app";

export default function PagesApp({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
