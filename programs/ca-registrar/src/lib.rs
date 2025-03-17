//! CA Domain Registrar Program
//!
//! This program manages the registration, renewal, and transfer of .ca domain names on Solana.
//! It provides functionality for domain lifecycle management, cross-chain address resolution,
//! and administrative controls for the name service.
//!
//! The program uses Pyth oracle for dynamic pricing based on SOL/USD exchange rates,
//! allowing users to pay for domain registrations in SOL while pricing is maintained in USD.

#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

use instructions::*;
use state::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

declare_id!("6rsq6P7d7WH1zF3DWJYzcfxTprUdL5q25AcXw8ZoCvDo");

#[program]
pub mod ca_registrar {
    use super::*;

    pub fn initialize(
        context: Context<InitializeAccountConstraints>, 
        base_price_usd: u64, 
        grace_period_seconds: i64,
    ) -> Result<()> {
        initialize_handler(context, base_price_usd, grace_period_seconds)
    }

    pub fn update_price(
        context: Context<UpdatePriceAccountConstraints>, 
        new_price: u64,
    ) -> Result<()> {
        update_price_handler(context, new_price)
    }

    pub fn update_authority(context: Context<UpdateAuthorityAccountConstraints>) -> Result<()> {
        update_authority_handler(context)
    }

    pub fn update_grace_period(
        context: Context<UpdateGracePeriodAccountConstraints>, 
        grace_period_seconds: i64,
    ) -> Result<()> {
        update_grace_period_handler(context, grace_period_seconds)
    }

    pub fn withdraw_fees(
        context: Context<WithdrawFeesAccountConstraints>, 
    ) -> Result<()> {
        withdraw_fees_handler(context)
    }

    pub fn register_domain(
        context: Context<RegisterDomainAccountConstraints>, 
        domain_name: String, 
        years: u64, 
        addresses: Vec<ChainAddress>,
        owner: Pubkey,
    ) -> Result<()> {
        register_domain_handler(context, domain_name, years, addresses, owner)
    }

    pub fn renew_domain(
        context: Context<RenewDomainAccountConstraints>, 
        _domain_name: String, 
        years: u64,
    ) -> Result<()> {
        renew_domain_handler(context, years)
    }

    pub fn buy_domain(
        context: Context<BuyDomainAccountConstraints>, 
        _domain_name: String, 
        years: u64, 
        addresses: Vec<ChainAddress>,
        owner: Pubkey,
    ) -> Result<()> {
        buy_domain_handler(context, years, addresses, owner)
    }

    pub fn update_addresses(
        context: Context<UpdateAddressesAccountConstraints>,
        _domain_name: String,
        addresses: Vec<ChainAddress>,
    ) -> Result<()> {
        update_addresses_handler(context, addresses)
    }

    pub fn transfer_domain(
        context: Context<TransferDomainAccountConstraints>, 
        _domain_name: String, 
        new_owner: Pubkey,
    ) -> Result<()> {
        transfer_domain_handler(context, new_owner)
    }
}
