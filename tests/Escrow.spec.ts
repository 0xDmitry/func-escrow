import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { beginCell, Cell, toNano } from '@ton/core';
import { JettonWallet } from '../wrappers/JettonWallet';
import { JettonMinter, jettonContentToCell } from '../wrappers/JettonMinter';
import { Escrow } from '../wrappers/Escrow';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';

describe('Escrow', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('Escrow');
    });

    let blockchain: Blockchain;
    let jettonMinterAdmin: SandboxContract<TreasuryContract>;
    let jettonWalletCode = new Cell();
    let jettonMinterCode = new Cell();
    let defaultContent: Cell;
    let jettonMinter: SandboxContract<JettonMinter>;
    let seller: SandboxContract<TreasuryContract>;
    let buyer: SandboxContract<TreasuryContract>;
    let guarantor: SandboxContract<TreasuryContract>;
    let escrow: SandboxContract<Escrow>;
    let sellerJettonWallet: SandboxContract<JettonWallet>;
    let buyerJettonWallet: SandboxContract<JettonWallet>;
    let guarantorJettonWallet: SandboxContract<JettonWallet>;
    let escrowJettonWallet: SandboxContract<JettonWallet>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        jettonMinterAdmin = await blockchain.treasury('jettonMinterAdmin');
        jettonWalletCode = await compile('JettonWallet');
        jettonMinterCode = await compile('JettonMinter');
        defaultContent = jettonContentToCell({ type: 1, uri: 'https://testjetton.org/content.json' });
        jettonMinter = blockchain.openContract(
            JettonMinter.createFromConfig(
                {
                    admin: jettonMinterAdmin.address,
                    content: defaultContent,
                    wallet_code: jettonWalletCode,
                },
                jettonMinterCode,
            ),
        );

        const deployJettonMinterResult = await jettonMinter.sendDeploy(jettonMinterAdmin.getSender(), toNano('1'));
        expect(deployJettonMinterResult.transactions).toHaveTransaction({
            from: jettonMinterAdmin.address,
            to: jettonMinter.address,
            deploy: true,
        });

        seller = await blockchain.treasury('seller');
        buyer = await blockchain.treasury('buyer');
        guarantor = await blockchain.treasury('guarantor');
        sellerJettonWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(seller.address)),
        );
        buyerJettonWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(buyer.address)),
        );
        guarantorJettonWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(guarantor.address)),
        );

        const mintResult = await jettonMinter.sendMint(
            jettonMinterAdmin.getSender(),
            buyer.address,
            toNano('100000'),
            toNano('0.05'),
            toNano('1'),
        );
        expect(mintResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            to: buyerJettonWallet.address,
            deploy: true,
        });
        expect(mintResult.transactions).toHaveTransaction({
            from: buyerJettonWallet.address,
            to: jettonMinter.address,
        });
    });

    it('TON approve by guarantor', async () => {
        escrow = blockchain.openContract(
            Escrow.createFromConfig(
                {
                    price: toNano('2'),
                    jetton_master: null,
                    jetton_wallet_code: beginCell().endCell(),
                    royalty_numerator: 1,
                    royalty_denominator: 100,
                    seller: seller.address,
                    buyer: buyer.address,
                    guarantor: guarantor.address,
                },
                code,
            ),
        );

        const deployResult = await escrow.sendDeploy(seller.getSender(), toNano('0.01'));
        expect(deployResult.transactions).toHaveTransaction({
            from: seller.address,
            to: escrow.address,
            deploy: true,
            success: true,
        });
        expect(await escrow.getFullPrice()).toBe(toNano('2.02'));
        expect(await escrow.getPrice()).toBe(toNano('2'));
        expect(await escrow.getJettonMaster()).toBeNull();
        expect(await escrow.getIsCompleted()).toBeFalsy();

        await buyer.send({
            value: toNano('2.02'),
            to: escrow.address,
        });

        const sendApproveResult = await escrow.sendApprove(guarantor.getSender(), toNano('0.01'), 0n);
        expect(sendApproveResult.transactions).toHaveTransaction({
            from: escrow.address,
            to: seller.address,
            value: toNano('2'),
            success: true,
        });
        expect(await escrow.getIsCompleted()).toBeTruthy();
    });

    it('TON approve by not guarantor', async () => {
        escrow = blockchain.openContract(
            Escrow.createFromConfig(
                {
                    price: toNano('2'),
                    jetton_master: null,
                    jetton_wallet_code: beginCell().endCell(),
                    royalty_numerator: 1,
                    royalty_denominator: 100,
                    seller: seller.address,
                    buyer: buyer.address,
                    guarantor: guarantor.address,
                },
                code,
            ),
        );

        const deployResult = await escrow.sendDeploy(seller.getSender(), toNano('0.01'));
        expect(deployResult.transactions).toHaveTransaction({
            from: seller.address,
            to: escrow.address,
            deploy: true,
            success: true,
        });
        expect(await escrow.getFullPrice()).toBe(toNano('2.02'));
        expect(await escrow.getPrice()).toBe(toNano('2'));
        expect(await escrow.getJettonMaster()).toBeNull();
        expect(await escrow.getIsCompleted()).toBeFalsy();

        await buyer.send({
            value: toNano('2.02'),
            to: escrow.address,
        });

        const sendApproveResult = await escrow.sendApprove(seller.getSender(), toNano('0.01'), 0n);
        expect(sendApproveResult.transactions).toHaveTransaction({
            from: seller.address,
            to: escrow.address,
            success: false,
            exitCode: 501,
        });
        expect(await escrow.getIsCompleted()).toBeFalsy();
    });

    it('TON refund by guarantor', async () => {
        escrow = blockchain.openContract(
            Escrow.createFromConfig(
                {
                    price: toNano('2'),
                    jetton_master: null,
                    jetton_wallet_code: beginCell().endCell(),
                    royalty_numerator: 1,
                    royalty_denominator: 100,
                    seller: seller.address,
                    buyer: buyer.address,
                    guarantor: guarantor.address,
                },
                code,
            ),
        );

        const deployResult = await escrow.sendDeploy(seller.getSender(), toNano('0.01'));
        expect(deployResult.transactions).toHaveTransaction({
            from: seller.address,
            to: escrow.address,
            deploy: true,
            success: true,
        });
        expect(await escrow.getFullPrice()).toBe(toNano('2.02'));
        expect(await escrow.getPrice()).toBe(toNano('2'));
        expect(await escrow.getJettonMaster()).toBeNull();
        expect(await escrow.getIsCompleted()).toBeFalsy();

        await buyer.send({
            value: toNano('2.02'),
            to: escrow.address,
        });

        const sendRefundResult = await escrow.sendRefund(guarantor.getSender(), toNano('0.01'), 0n);
        expect(sendRefundResult.transactions).toHaveTransaction({
            from: escrow.address,
            to: buyer.address,
            value: toNano('2'),
            success: true,
        });
        expect(await escrow.getIsCompleted()).toBeTruthy();
    });

    it('TON refund by not guarantor', async () => {
        escrow = blockchain.openContract(
            Escrow.createFromConfig(
                {
                    price: toNano('2'),
                    jetton_master: null,
                    jetton_wallet_code: beginCell().endCell(),
                    royalty_numerator: 1,
                    royalty_denominator: 100,
                    seller: seller.address,
                    buyer: buyer.address,
                    guarantor: guarantor.address,
                },
                code,
            ),
        );

        const deployResult = await escrow.sendDeploy(seller.getSender(), toNano('0.01'));
        expect(deployResult.transactions).toHaveTransaction({
            from: seller.address,
            to: escrow.address,
            deploy: true,
            success: true,
        });
        expect(await escrow.getFullPrice()).toBe(toNano('2.02'));
        expect(await escrow.getPrice()).toBe(toNano('2'));
        expect(await escrow.getJettonMaster()).toBeNull();
        expect(await escrow.getIsCompleted()).toBeFalsy();

        await buyer.send({
            value: toNano('2.02'),
            to: escrow.address,
        });

        const sendRefundResult = await escrow.sendRefund(buyer.getSender(), toNano('0.01'), 0n);
        expect(sendRefundResult.transactions).toHaveTransaction({
            from: buyer.address,
            to: escrow.address,
            success: false,
            exitCode: 501,
        });
        expect(await escrow.getIsCompleted()).toBeFalsy();
    });

    it('TON collect royalties from completed deal by guarantor', async () => {
        escrow = blockchain.openContract(
            Escrow.createFromConfig(
                {
                    price: toNano('2'),
                    jetton_master: null,
                    jetton_wallet_code: beginCell().endCell(),
                    royalty_numerator: 1,
                    royalty_denominator: 100,
                    seller: seller.address,
                    buyer: buyer.address,
                    guarantor: guarantor.address,
                },
                code,
            ),
        );

        const deployResult = await escrow.sendDeploy(seller.getSender(), toNano('0.01'));
        expect(deployResult.transactions).toHaveTransaction({
            from: seller.address,
            to: escrow.address,
            deploy: true,
            success: true,
        });
        expect(await escrow.getFullPrice()).toBe(toNano('2.02'));
        expect(await escrow.getPrice()).toBe(toNano('2'));
        expect(await escrow.getJettonMaster()).toBeNull();
        expect(await escrow.getIsCompleted()).toBeFalsy();

        await buyer.send({
            value: toNano('2.02'),
            to: escrow.address,
        });

        const sendApproveResult = await escrow.sendApprove(guarantor.getSender(), toNano('0.01'), 0n);
        expect(sendApproveResult.transactions).toHaveTransaction({
            from: escrow.address,
            to: seller.address,
            value: toNano('2'),
            success: true,
        });
        expect(await escrow.getIsCompleted()).toBeTruthy();

        const sendCollectRoyaltiesResult = await escrow.sendCollectRoyalties(guarantor.getSender(), toNano('0.01'), 0n);
        expect(sendCollectRoyaltiesResult.transactions).toHaveTransaction({
            from: guarantor.address,
            to: escrow.address,
            endStatus: 'non-existing',
            success: true,
        });
        expect(sendCollectRoyaltiesResult.transactions).toHaveTransaction({
            from: escrow.address,
            to: guarantor.address,
            value: 45228800n,
            success: true,
        });
    });

    it('TON collect royalties from completed deal by not guarantor', async () => {
        escrow = blockchain.openContract(
            Escrow.createFromConfig(
                {
                    price: toNano('2'),
                    jetton_master: null,
                    jetton_wallet_code: beginCell().endCell(),
                    royalty_numerator: 1,
                    royalty_denominator: 100,
                    seller: seller.address,
                    buyer: buyer.address,
                    guarantor: guarantor.address,
                },
                code,
            ),
        );

        const deployResult = await escrow.sendDeploy(seller.getSender(), toNano('0.01'));
        expect(deployResult.transactions).toHaveTransaction({
            from: seller.address,
            to: escrow.address,
            deploy: true,
            success: true,
        });
        expect(await escrow.getFullPrice()).toBe(toNano('2.02'));
        expect(await escrow.getPrice()).toBe(toNano('2'));
        expect(await escrow.getJettonMaster()).toBeNull();
        expect(await escrow.getIsCompleted()).toBeFalsy();

        await buyer.send({
            value: toNano('2.02'),
            to: escrow.address,
        });

        const sendApproveResult = await escrow.sendApprove(guarantor.getSender(), toNano('0.01'), 0n);
        expect(sendApproveResult.transactions).toHaveTransaction({
            from: escrow.address,
            to: seller.address,
            value: toNano('2'),
            success: true,
        });
        expect(await escrow.getIsCompleted()).toBeTruthy();

        const sendCollectRoyaltiesResult = await escrow.sendCollectRoyalties(seller.getSender(), toNano('0.01'), 0n);
        expect(sendCollectRoyaltiesResult.transactions).toHaveTransaction({
            from: seller.address,
            to: escrow.address,
            exitCode: 501,
            success: false,
        });
        expect(await escrow.getIsCompleted()).toBeTruthy();
    });

    it('TON collect royalties from not completed deal by guarantor', async () => {
        escrow = blockchain.openContract(
            Escrow.createFromConfig(
                {
                    price: toNano('2'),
                    jetton_master: null,
                    jetton_wallet_code: beginCell().endCell(),
                    royalty_numerator: 1,
                    royalty_denominator: 100,
                    seller: seller.address,
                    buyer: buyer.address,
                    guarantor: guarantor.address,
                },
                code,
            ),
        );

        const deployResult = await escrow.sendDeploy(seller.getSender(), toNano('0.01'));
        expect(deployResult.transactions).toHaveTransaction({
            from: seller.address,
            to: escrow.address,
            deploy: true,
            success: true,
        });
        expect(await escrow.getFullPrice()).toBe(toNano('2.02'));
        expect(await escrow.getPrice()).toBe(toNano('2'));
        expect(await escrow.getJettonMaster()).toBeNull();
        expect(await escrow.getIsCompleted()).toBeFalsy();

        await buyer.send({
            value: toNano('2.02'),
            to: escrow.address,
        });

        const sendCollectRoyaltiesResult = await escrow.sendCollectRoyalties(guarantor.getSender(), toNano('0.01'), 0n);
        expect(sendCollectRoyaltiesResult.transactions).toHaveTransaction({
            from: guarantor.address,
            to: escrow.address,
            exitCode: 502,
            success: false,
        });
        expect(await escrow.getIsCompleted()).toBeFalsy();
    });

    it('Jetton approve by guarantor', async () => {
        escrow = blockchain.openContract(
            Escrow.createFromConfig(
                {
                    price: toNano('1000'),
                    jetton_master: jettonMinter.address,
                    jetton_wallet_code: jettonWalletCode,
                    royalty_numerator: 5,
                    royalty_denominator: 100,
                    seller: seller.address,
                    buyer: buyer.address,
                    guarantor: guarantor.address,
                },
                code,
            ),
        );
        escrowJettonWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(escrow.address)),
        );

        const deployResult = await escrow.sendDeploy(seller.getSender(), toNano('0.01'));
        expect(deployResult.transactions).toHaveTransaction({
            from: seller.address,
            to: escrow.address,
            deploy: true,
            success: true,
        });
        expect(await escrow.getFullPrice()).toBe(toNano('1050'));
        expect(await escrow.getPrice()).toBe(toNano('1000'));
        expect(await escrow.getJettonMaster()).toEqualAddress(jettonMinter.address);
        expect(await escrow.getIsCompleted()).toBeFalsy();
        expect(await escrowJettonWallet.getJettonBalance()).toEqual(toNano('0'));
        expect(await sellerJettonWallet.getJettonBalance()).toEqual(toNano('0'));

        await buyerJettonWallet.sendTransfer(
            buyer.getSender(),
            toNano('0.05'),
            toNano('1050'),
            escrow.address,
            escrow.address,
            beginCell().endCell(),
            0n,
            beginCell().endCell(),
        );
        expect(await escrowJettonWallet.getJettonBalance()).toEqual(toNano('1050'));
        expect(await sellerJettonWallet.getJettonBalance()).toEqual(toNano('0'));

        const sendApproveResult = await escrow.sendApprove(guarantor.getSender(), toNano('0.05'), 0n);
        expect(sendApproveResult.transactions).toHaveTransaction({
            from: escrowJettonWallet.address,
            to: sellerJettonWallet.address,
            success: true,
        });
        expect(await escrow.getIsCompleted()).toBeTruthy();
        expect(await escrowJettonWallet.getJettonBalance()).toEqual(toNano('50'));
        expect(await sellerJettonWallet.getJettonBalance()).toEqual(toNano('1000'));
    });

    it('Jetton approve by not guarantor', async () => {
        escrow = blockchain.openContract(
            Escrow.createFromConfig(
                {
                    price: toNano('1000'),
                    jetton_master: jettonMinter.address,
                    jetton_wallet_code: jettonWalletCode,
                    royalty_numerator: 5,
                    royalty_denominator: 100,
                    seller: seller.address,
                    buyer: buyer.address,
                    guarantor: guarantor.address,
                },
                code,
            ),
        );
        escrowJettonWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(escrow.address)),
        );

        const deployResult = await escrow.sendDeploy(seller.getSender(), toNano('0.01'));
        expect(deployResult.transactions).toHaveTransaction({
            from: seller.address,
            to: escrow.address,
            deploy: true,
            success: true,
        });
        expect(await escrow.getFullPrice()).toBe(toNano('1050'));
        expect(await escrow.getPrice()).toBe(toNano('1000'));
        expect(await escrow.getJettonMaster()).toEqualAddress(jettonMinter.address);
        expect(await escrow.getIsCompleted()).toBeFalsy();
        expect(await escrowJettonWallet.getJettonBalance()).toEqual(toNano('0'));
        expect(await sellerJettonWallet.getJettonBalance()).toEqual(toNano('0'));

        await buyerJettonWallet.sendTransfer(
            buyer.getSender(),
            toNano('0.05'),
            toNano('1050'),
            escrow.address,
            escrow.address,
            beginCell().endCell(),
            0n,
            beginCell().endCell(),
        );
        expect(await escrowJettonWallet.getJettonBalance()).toEqual(toNano('1050'));
        expect(await sellerJettonWallet.getJettonBalance()).toEqual(toNano('0'));

        const sendApproveResult = await escrow.sendApprove(seller.getSender(), toNano('0.05'), 0n);
        expect(sendApproveResult.transactions).toHaveTransaction({
            from: seller.address,
            to: escrow.address,
            success: false,
            exitCode: 501,
        });
        expect(await escrow.getIsCompleted()).toBeFalsy();
        expect(await escrowJettonWallet.getJettonBalance()).toEqual(toNano('1050'));
        expect(await sellerJettonWallet.getJettonBalance()).toEqual(toNano('0'));
    });

    it('Jetton refund by guarantor', async () => {
        escrow = blockchain.openContract(
            Escrow.createFromConfig(
                {
                    price: toNano('1000'),
                    jetton_master: jettonMinter.address,
                    jetton_wallet_code: jettonWalletCode,
                    royalty_numerator: 5,
                    royalty_denominator: 100,
                    seller: seller.address,
                    buyer: buyer.address,
                    guarantor: guarantor.address,
                },
                code,
            ),
        );
        escrowJettonWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(escrow.address)),
        );

        const deployResult = await escrow.sendDeploy(seller.getSender(), toNano('0.01'));
        expect(deployResult.transactions).toHaveTransaction({
            from: seller.address,
            to: escrow.address,
            deploy: true,
            success: true,
        });
        expect(await escrow.getFullPrice()).toBe(toNano('1050'));
        expect(await escrow.getPrice()).toBe(toNano('1000'));
        expect(await escrow.getJettonMaster()).toEqualAddress(jettonMinter.address);
        expect(await escrow.getIsCompleted()).toBeFalsy();
        expect(await escrowJettonWallet.getJettonBalance()).toEqual(toNano('0'));
        expect(await buyerJettonWallet.getJettonBalance()).toEqual(toNano('100000'));

        await buyerJettonWallet.sendTransfer(
            buyer.getSender(),
            toNano('0.05'),
            toNano('1050'),
            escrow.address,
            escrow.address,
            beginCell().endCell(),
            0n,
            beginCell().endCell(),
        );
        expect(await escrowJettonWallet.getJettonBalance()).toEqual(toNano('1050'));
        expect(await buyerJettonWallet.getJettonBalance()).toEqual(toNano('98950'));

        const sendRefundResult = await escrow.sendRefund(guarantor.getSender(), toNano('0.05'), 0n);
        expect(sendRefundResult.transactions).toHaveTransaction({
            from: escrowJettonWallet.address,
            to: buyerJettonWallet.address,
            success: true,
        });
        expect(await escrow.getIsCompleted()).toBeTruthy();
        expect(await escrowJettonWallet.getJettonBalance()).toEqual(toNano('50'));
        expect(await buyerJettonWallet.getJettonBalance()).toEqual(toNano('99950'));
    });

    it('Jetton refund by not guarantor', async () => {
        escrow = blockchain.openContract(
            Escrow.createFromConfig(
                {
                    price: toNano('1000'),
                    jetton_master: jettonMinter.address,
                    jetton_wallet_code: jettonWalletCode,
                    royalty_numerator: 5,
                    royalty_denominator: 100,
                    seller: seller.address,
                    buyer: buyer.address,
                    guarantor: guarantor.address,
                },
                code,
            ),
        );
        escrowJettonWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(escrow.address)),
        );

        const deployResult = await escrow.sendDeploy(seller.getSender(), toNano('0.01'));
        expect(deployResult.transactions).toHaveTransaction({
            from: seller.address,
            to: escrow.address,
            deploy: true,
            success: true,
        });
        expect(await escrow.getFullPrice()).toBe(toNano('1050'));
        expect(await escrow.getPrice()).toBe(toNano('1000'));
        expect(await escrow.getJettonMaster()).toEqualAddress(jettonMinter.address);
        expect(await escrow.getIsCompleted()).toBeFalsy();
        expect(await escrowJettonWallet.getJettonBalance()).toEqual(toNano('0'));
        expect(await buyerJettonWallet.getJettonBalance()).toEqual(toNano('100000'));

        await buyerJettonWallet.sendTransfer(
            buyer.getSender(),
            toNano('0.05'),
            toNano('1050'),
            escrow.address,
            escrow.address,
            beginCell().endCell(),
            0n,
            beginCell().endCell(),
        );
        expect(await escrowJettonWallet.getJettonBalance()).toEqual(toNano('1050'));
        expect(await buyerJettonWallet.getJettonBalance()).toEqual(toNano('98950'));

        const sendRefundResult = await escrow.sendRefund(buyer.getSender(), toNano('0.05'), 0n);
        expect(sendRefundResult.transactions).toHaveTransaction({
            from: buyer.address,
            to: escrow.address,
            success: false,
            exitCode: 501,
        });
        expect(await escrow.getIsCompleted()).toBeFalsy();
        expect(await escrowJettonWallet.getJettonBalance()).toEqual(toNano('1050'));
        expect(await buyerJettonWallet.getJettonBalance()).toEqual(toNano('98950'));
    });

    it('Jetton collect royalties from completed deal by guarantor', async () => {
        escrow = blockchain.openContract(
            Escrow.createFromConfig(
                {
                    price: toNano('1000'),
                    jetton_master: jettonMinter.address,
                    jetton_wallet_code: jettonWalletCode,
                    royalty_numerator: 5,
                    royalty_denominator: 100,
                    seller: seller.address,
                    buyer: buyer.address,
                    guarantor: guarantor.address,
                },
                code,
            ),
        );
        escrowJettonWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(escrow.address)),
        );

        const deployResult = await escrow.sendDeploy(seller.getSender(), toNano('0.01'));
        expect(deployResult.transactions).toHaveTransaction({
            from: seller.address,
            to: escrow.address,
            deploy: true,
            success: true,
        });
        expect(await escrow.getFullPrice()).toBe(toNano('1050'));
        expect(await escrow.getPrice()).toBe(toNano('1000'));
        expect(await escrow.getJettonMaster()).toEqualAddress(jettonMinter.address);
        expect(await escrow.getIsCompleted()).toBeFalsy();
        expect(await escrowJettonWallet.getJettonBalance()).toEqual(toNano('0'));
        expect(await sellerJettonWallet.getJettonBalance()).toEqual(toNano('0'));
        expect(await guarantorJettonWallet.getJettonBalance()).toEqual(toNano('0'));

        await buyerJettonWallet.sendTransfer(
            buyer.getSender(),
            toNano('0.05'),
            toNano('1050'),
            escrow.address,
            escrow.address,
            beginCell().endCell(),
            0n,
            beginCell().endCell(),
        );
        expect(await escrowJettonWallet.getJettonBalance()).toEqual(toNano('1050'));
        expect(await sellerJettonWallet.getJettonBalance()).toEqual(toNano('0'));
        expect(await guarantorJettonWallet.getJettonBalance()).toEqual(toNano('0'));

        const sendApproveResult = await escrow.sendApprove(guarantor.getSender(), toNano('0.05'), 0n);
        expect(sendApproveResult.transactions).toHaveTransaction({
            from: escrowJettonWallet.address,
            to: sellerJettonWallet.address,
            success: true,
        });
        expect(await escrow.getIsCompleted()).toBeTruthy();
        expect(await escrowJettonWallet.getJettonBalance()).toEqual(toNano('50'));
        expect(await sellerJettonWallet.getJettonBalance()).toEqual(toNano('1000'));
        expect(await guarantorJettonWallet.getJettonBalance()).toEqual(toNano('0'));

        const sendCollectRoyaltiesResult = await escrow.sendCollectRoyalties(guarantor.getSender(), toNano('0.05'), 0n);
        expect(sendCollectRoyaltiesResult.transactions).toHaveTransaction({
            from: guarantor.address,
            to: escrow.address,
            endStatus: 'non-existing',
            success: true,
        });
        expect(sendCollectRoyaltiesResult.transactions).toHaveTransaction({
            from: escrowJettonWallet.address,
            to: guarantorJettonWallet.address,
            success: true,
        });
        expect(await escrowJettonWallet.getJettonBalance()).toEqual(toNano('0'));
        expect(await sellerJettonWallet.getJettonBalance()).toEqual(toNano('1000'));
        expect(await guarantorJettonWallet.getJettonBalance()).toEqual(toNano('50'));
    });

    it('Jetton collect royalties from completed deal by not guarantor', async () => {
        escrow = blockchain.openContract(
            Escrow.createFromConfig(
                {
                    price: toNano('1000'),
                    jetton_master: jettonMinter.address,
                    jetton_wallet_code: jettonWalletCode,
                    royalty_numerator: 5,
                    royalty_denominator: 100,
                    seller: seller.address,
                    buyer: buyer.address,
                    guarantor: guarantor.address,
                },
                code,
            ),
        );
        escrowJettonWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(escrow.address)),
        );

        const deployResult = await escrow.sendDeploy(seller.getSender(), toNano('0.01'));
        expect(deployResult.transactions).toHaveTransaction({
            from: seller.address,
            to: escrow.address,
            deploy: true,
            success: true,
        });
        expect(await escrow.getFullPrice()).toBe(toNano('1050'));
        expect(await escrow.getPrice()).toBe(toNano('1000'));
        expect(await escrow.getJettonMaster()).toEqualAddress(jettonMinter.address);
        expect(await escrow.getIsCompleted()).toBeFalsy();
        expect(await escrowJettonWallet.getJettonBalance()).toEqual(toNano('0'));
        expect(await sellerJettonWallet.getJettonBalance()).toEqual(toNano('0'));
        expect(await guarantorJettonWallet.getJettonBalance()).toEqual(toNano('0'));

        await buyerJettonWallet.sendTransfer(
            buyer.getSender(),
            toNano('0.05'),
            toNano('1050'),
            escrow.address,
            escrow.address,
            beginCell().endCell(),
            0n,
            beginCell().endCell(),
        );
        expect(await escrowJettonWallet.getJettonBalance()).toEqual(toNano('1050'));
        expect(await sellerJettonWallet.getJettonBalance()).toEqual(toNano('0'));
        expect(await guarantorJettonWallet.getJettonBalance()).toEqual(toNano('0'));

        const sendApproveResult = await escrow.sendApprove(guarantor.getSender(), toNano('0.05'), 0n);
        expect(sendApproveResult.transactions).toHaveTransaction({
            from: escrowJettonWallet.address,
            to: sellerJettonWallet.address,
            success: true,
        });
        expect(await escrow.getIsCompleted()).toBeTruthy();
        expect(await escrowJettonWallet.getJettonBalance()).toEqual(toNano('50'));
        expect(await sellerJettonWallet.getJettonBalance()).toEqual(toNano('1000'));
        expect(await guarantorJettonWallet.getJettonBalance()).toEqual(toNano('0'));

        const sendCollectRoyaltiesResult = await escrow.sendCollectRoyalties(seller.getSender(), toNano('0.05'), 0n);
        expect(sendCollectRoyaltiesResult.transactions).toHaveTransaction({
            from: seller.address,
            to: escrow.address,
            exitCode: 501,
            success: false,
        });
        expect(await escrow.getIsCompleted()).toBeTruthy();
        expect(await escrowJettonWallet.getJettonBalance()).toEqual(toNano('50'));
        expect(await sellerJettonWallet.getJettonBalance()).toEqual(toNano('1000'));
        expect(await guarantorJettonWallet.getJettonBalance()).toEqual(toNano('0'));
    });

    it('Jetton collect royalties from not completed deal by guarantor', async () => {
        escrow = blockchain.openContract(
            Escrow.createFromConfig(
                {
                    price: toNano('1000'),
                    jetton_master: jettonMinter.address,
                    jetton_wallet_code: jettonWalletCode,
                    royalty_numerator: 5,
                    royalty_denominator: 100,
                    seller: seller.address,
                    buyer: buyer.address,
                    guarantor: guarantor.address,
                },
                code,
            ),
        );
        escrowJettonWallet = blockchain.openContract(
            JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(escrow.address)),
        );

        const deployResult = await escrow.sendDeploy(seller.getSender(), toNano('0.01'));
        expect(deployResult.transactions).toHaveTransaction({
            from: seller.address,
            to: escrow.address,
            deploy: true,
            success: true,
        });
        expect(await escrow.getFullPrice()).toBe(toNano('1050'));
        expect(await escrow.getPrice()).toBe(toNano('1000'));
        expect(await escrow.getJettonMaster()).toEqualAddress(jettonMinter.address);
        expect(await escrow.getIsCompleted()).toBeFalsy();
        expect(await escrowJettonWallet.getJettonBalance()).toEqual(toNano('0'));
        expect(await sellerJettonWallet.getJettonBalance()).toEqual(toNano('0'));
        expect(await guarantorJettonWallet.getJettonBalance()).toEqual(toNano('0'));

        await buyerJettonWallet.sendTransfer(
            buyer.getSender(),
            toNano('0.05'),
            toNano('1050'),
            escrow.address,
            escrow.address,
            beginCell().endCell(),
            0n,
            beginCell().endCell(),
        );
        expect(await escrowJettonWallet.getJettonBalance()).toEqual(toNano('1050'));
        expect(await sellerJettonWallet.getJettonBalance()).toEqual(toNano('0'));
        expect(await guarantorJettonWallet.getJettonBalance()).toEqual(toNano('0'));

        const sendCollectRoyaltiesResult = await escrow.sendCollectRoyalties(guarantor.getSender(), toNano('0.05'), 0n);
        expect(sendCollectRoyaltiesResult.transactions).toHaveTransaction({
            from: guarantor.address,
            to: escrow.address,
            exitCode: 502,
            success: false,
        });
        expect(await escrow.getIsCompleted()).toBeFalsy();
        expect(await escrowJettonWallet.getJettonBalance()).toEqual(toNano('1050'));
        expect(await sellerJettonWallet.getJettonBalance()).toEqual(toNano('0'));
        expect(await guarantorJettonWallet.getJettonBalance()).toEqual(toNano('0'));
    });
});
