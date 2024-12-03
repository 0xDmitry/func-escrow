import { Address, toNano } from '@ton/core';
import { Escrow } from '../wrappers/Escrow';
import { compile, NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const escrow = provider.open(
        Escrow.createFromConfig(
            {
                price: toNano('1000'),
                jetton_master: Address.parseFriendly('0QD6uj2yWpn5o0OlZ2LqlI24Gn-_E2TvuS3wOkSQI7FDmkJQ').address,
                jetton_wallet_code: await compile('JettonWallet'),
                royalty_numerator: 5,
                royalty_denominator: 100,
                seller: Address.parseFriendly('0QC8rz-GAgIMM5dsZwy7xC1Nrf_WxdriXutUD06w21k_7qbq').address,
                buyer: Address.parseFriendly('0QBHpCsjmgQESLwOr2C3t3Bc85kQ-J3QMbLgHRz9htsR6M7B').address,
                guarantor: Address.parseFriendly('0QCbSVFQasPJk3K3ifTE5tWmfykTU6b_mBx6f9EqGFwBmirA').address,
            },
            await compile('Escrow'),
        ),
    );

    await escrow.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(escrow.address);
}
