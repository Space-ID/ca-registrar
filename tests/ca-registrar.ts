import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { CaRegistrar } from "../target/types/ca_registrar";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";
import { assert } from "chai";

describe("ca-registrar", () => {
  const provider = anchor.AnchorProvider.env();
  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;
  
  // Configure the client to use the local cluster.
  anchor.setProvider(provider);

  const program = anchor.workspace.CaRegistrar as Program<CaRegistrar>;
  
  // Set up Pyth price feed
  const pythSolanaReceiver = new PythSolanaReceiver({ connection, wallet });
  const SOL_USD_PRICE_FEED_ID = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
  const solUsdPriceFeedAccount = pythSolanaReceiver.getPriceFeedAccountAddress(0, SOL_USD_PRICE_FEED_ID);
  console.log("solUsdPriceFeedAccount", solUsdPriceFeedAccount);

  // Set up program state PDA
  const PROGRAM_STATE_SEED = Buffer.from("state");
  const [programStateAccount] = anchor.web3.PublicKey.findProgramAddressSync(
    [PROGRAM_STATE_SEED],
    program.programId
  );
  console.log("Program State PDA:", programStateAccount.toString());

  it("Is initialized!", async () => {
    // Configuration values
    const basePriceUsd = new BN(500); // $5.00 in cents
    const gracePeriodSeconds = new BN(604800); // 7 days in seconds
    
    // Initialize the program
    const tx = await program.methods
      .initialize(basePriceUsd, gracePeriodSeconds)
      .accounts({
        // @ts-expect-error - Anchor naming convention issue
        programState: programStateAccount,
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    
    console.log("Your transaction signature", tx);
  });
  
  it("Can register a domain", async () => {
    // 测试域名
    const domainName = "testdomain";
    const years = new BN(1);
    
    // 创建一些区块链地址
    const addresses = [
      {
        chain_id: 0, // Solana
        address: wallet.publicKey.toBase58(),
      },
      {
        chain_id: 1, // Ethereum
        address: "0x1234567890123456789012345678901234567890",
      }
    ];
    
    // 计算域名记录的 PDA
    const DOMAIN_RECORD_SEED = Buffer.from("domain");
    const [domainRecordAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [DOMAIN_RECORD_SEED, Buffer.from(domainName)],
      program.programId
    );
    
    console.log("Domain Record PDA:", domainRecordAccount.toString());
    
    try {
      // 注册域名
      const tx = await program.methods
        .registerDomain(
          domainName,
          years,
          addresses,
          wallet.publicKey
        )
        .accounts({
          buyer: wallet.publicKey,
          domainRecord: domainRecordAccount,
          programState: programStateAccount,
          pythPriceUpdate: solUsdPriceFeedAccount,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc({ skipPreflight: true, commitment: "confirmed" });
      
      console.log("Domain registration transaction:", tx);
      
      // 获取并验证域名记录
      const domainRecord = await program.account.domainRecord.fetch(domainRecordAccount);
      console.log("Domain record:", {
        name: domainRecord.domainName,
        owner: domainRecord.owner.toString(),
        expiryTimestamp: new Date(domainRecord.expiryTimestamp as any * 1000).toISOString(),
        addresses: domainRecord.addresses,
      });
      
      // 执行断言验证结果
      assert.equal(domainRecord.domainName, domainName);
      assert.equal(domainRecord.owner.toString(), wallet.publicKey.toString());
      assert.equal(domainRecord.addresses.length, 2);
      
    } catch (error) {
      console.error("Error registering domain:", error);
      throw error;
    }
  });

  it("Can update domain addresses", async () => {
    // 使用之前注册的测试域名
    const domainName = "testdomain";
    
    // 计算域名记录的 PDA
    const DOMAIN_RECORD_SEED = Buffer.from("domain");
    const [domainRecordPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [DOMAIN_RECORD_SEED, Buffer.from(domainName)],
      program.programId
    );
    
    // 创建新的区块链地址列表
    const updatedAddresses = [
      {
        chain_id: 0, // Solana
        address: wallet.publicKey.toBase58(),
      },
      {
        chain_id: 1, // Ethereum
        address: "0x1234567890123456789012345678901234567890",
      },
      {
        chain_id: 2, // Sui
        address: "0x7890123456789012345678901234567890123456",
      }
    ];
    
    try {
      // 更新域名地址
      const tx = await program.methods
        .updateAddresses(
          domainName,
          updatedAddresses
        )
        // @ts-expect-error - Anchor naming convention issue
        .accounts({
          owner: wallet.publicKey,
          domain_record: domainRecordPDA,
        })
        .rpc({ skipPreflight: true, commitment: "confirmed" });
      
      console.log("Address update transaction:", tx);
      
      // 获取并验证更新后的域名记录
      const domainRecord = await program.account.domainRecord.fetch(domainRecordPDA);
      
      // 执行断言验证结果
      assert.equal(domainRecord.addresses.length, 3);
      assert.equal(domainRecord.addresses[2].chain_id, 2);
      assert.equal(domainRecord.addresses[2].address, "0x7890123456789012345678901234567890123456");
      
      console.log("Domain addresses updated successfully");
      
    } catch (error) {
      console.error("Error updating domain addresses:", error);
      throw error;
    }
  });
});
