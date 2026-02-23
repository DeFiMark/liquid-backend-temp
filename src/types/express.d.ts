declare namespace Express {
  interface Request {
    user?: {
      id: string;
      address: string;
      eoa?: string;
      role: string;
    };
  }
}
