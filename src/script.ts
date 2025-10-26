import axios from 'axios';
import { base64 } from 'rfc4648';
import { ethers } from 'ethers';

// 类型定义
interface PaymentRequirements {
  x402Version: number;
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: { name: string; version: string };
}

interface PaymentResponse {
  x402Version: number;
  accepts: PaymentRequirements[];
  error?: string;
}

interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
}

const SERVER_URL = process.env.SERVER_URL || 'https://your-vercel-app.vercel.app/api/protected-endpoint';
const FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://facilitator.example.com';

const connectWalletButton = document.getElementById('connectWallet') as HTMLButtonElement;
const makePaymentButton = document.getElementById('makePayment') as HTMLButtonElement;
const walletStatus = document.getElementById('walletStatus') as HTMLParagraphElement;
const result = document.getElementById('result') as HTMLParagraphElement;

// 检查DOM元素是否存在
if (!connectWalletButton || !makePaymentButton || !walletStatus || !result) {
  throw new Error('Required DOM elements not found');
}

let provider: ethers.BrowserProvider | null = null;
let signer: ethers.Signer | null = null;
let walletAddress: string | null = null;

connectWalletButton.addEventListener('click', async () => {
  if (typeof window.ethereum !== 'undefined') {
    try {
      provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send('eth_requestAccounts', []);
      signer = await provider.getSigner();
      walletAddress = await signer.getAddress();
      walletStatus.textContent = `Wallet connected: ${walletAddress}`;
      makePaymentButton.disabled = false;
    } catch (error) {
      walletStatus.textContent = 'Failed to connect wallet';
      console.error(error);
    }
  } else {
    walletStatus.textContent = 'MetaMask not detected';
  }
});

makePaymentButton.addEventListener('click', async () => {
  if (!signer || !walletAddress) {
    result.textContent = 'Please connect wallet first';
    return;
  }

  try {
    result.textContent = 'Requesting payment requirements...';
    const response = await axios.get<PaymentResponse>(SERVER_URL);
    if (response.status !== 402) {
      throw new Error('Unexpected response status');
    }

    const paymentReq = response.data.accepts[0];
    const { maxAmountRequired, asset, network } = paymentReq;

    const payload = {
      x402Version: 1,
      scheme: 'exact',
      network,
      payload: {
        amount: maxAmountRequired,
        asset,
        signature: await signer.signMessage(
          JSON.stringify({ amount: maxAmountRequired, asset })
        ),
      },
    };

    const encodedPayload = base64.stringify(Buffer.from(JSON.stringify(payload)));

    result.textContent = 'Verifying payment with Facilitator...';
    const verifyResponse = await axios.post<VerifyResponse>(`${FACILITATOR_URL}/verify`, {
      x402Version: 1,
      paymentHeader: encodedPayload,
      paymentRequirements: paymentReq,
    });

    if (!verifyResponse.data.isValid) {
      throw new Error(verifyResponse.data.invalidReason || 'Payment verification failed');
    }

    result.textContent = 'Sending payment...';
    const payResponse = await axios.get(SERVER_URL, {
      headers: {
        'X-PAYMENT': encodedPayload,
        'X-PAYER': walletAddress,
      },
    });

    result.textContent = `Success: ${JSON.stringify(payResponse.data)}`;
  } catch (error: any) {
    result.textContent = `Error: ${error.response?.data?.error || error.message}`;
    console.error(error);
  }
});