declare module "qrcode" {
  const QRCode: {
    toDataURL(
      text: string,
      options?: {
        margin?: number;
        width?: number;
      },
    ): Promise<string>;
  };

  export default QRCode;
}
