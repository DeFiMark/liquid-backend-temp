declare namespace Express {
  interface Request {
    user?: {
      address: string;
      eoa?: string;
    };
  }
}
