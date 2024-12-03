import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from '@ton/core';

export type EscrowConfig = {
    price: bigint;
    jetton_master: Address | null;
    jetton_wallet_code: Cell;
    royalty_numerator: number;
    royalty_denominator: number;
    seller: Address;
    buyer: Address;
    guarantor: Address;
};

export function escrowConfigToCell(config: EscrowConfig): Cell {
    return beginCell()
        .storeCoins(config.price)
        .storeAddress(config.jetton_master)
        .storeRef(config.jetton_wallet_code)
        .storeUint(config.royalty_numerator, 16)
        .storeUint(config.royalty_denominator, 16)
        .storeUint(0, 1)
        .storeRef(
            beginCell().storeAddress(config.seller).storeAddress(config.buyer).storeAddress(config.guarantor).endCell(),
        )
        .endCell();
}

export class Escrow implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new Escrow(address);
    }

    static createFromConfig(config: EscrowConfig, code: Cell, workchain = 0) {
        const data = escrowConfigToCell(config);
        const init = { code, data };
        return new Escrow(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendApprove(provider: ContractProvider, sender: Sender, value: bigint, query_id: bigint) {
        const msg_body = beginCell().storeUint(0x845dda8c, 32).storeUint(query_id, 64).endCell();

        await provider.internal(sender, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: msg_body,
        });
    }

    async sendRefund(provider: ContractProvider, sender: Sender, value: bigint, query_id: bigint) {
        const msg_body = beginCell().storeUint(0x5b2c1458, 32).storeUint(query_id, 64).endCell();

        await provider.internal(sender, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: msg_body,
        });
    }

    async sendCollectRoyalties(provider: ContractProvider, sender: Sender, value: bigint, query_id: bigint) {
        const msg_body = beginCell().storeUint(0xf6f53c87, 32).storeUint(query_id, 64).endCell();

        await provider.internal(sender, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: msg_body,
        });
    }

    async getFullPrice(provider: ContractProvider) {
        const { stack } = await provider.get('get_full_price', []);
        return stack.readBigNumber();
    }

    async getPrice(provider: ContractProvider) {
        const { stack } = await provider.get('get_price', []);
        return stack.readBigNumber();
    }

    async getJettonMaster(provider: ContractProvider) {
        const { stack } = await provider.get('get_jetton_master', []);
        return stack.readAddressOpt();
    }

    async getIsCompleted(provider: ContractProvider) {
        const { stack } = await provider.get('get_is_completed', []);
        return stack.readBoolean();
    }
}
