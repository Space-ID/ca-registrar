#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, transfer};
use crate::constants::*;
use crate::state::*;
use crate::instructions::utils::*;
use crate::instructions::register::utils::*;
use crate::error::CaRegistrarError;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

/// Account constraints for domain registration instruction
/// 
/// This instruction allows users to register a new .ca domain, provided the domain has never been registered before.
/// If the domain has been registered before but has expired, the buy_domain instruction must be used.
#[derive(Accounts)]
#[instruction(domain_name: String)]
pub struct RegisterDomainAccountConstraints<'info> {
    /// User paying for domain registration fees, who will also be the initial owner
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// Account storing domain information, using the domain name as a seed for PDA derivation
    #[account(
        init,
        payer = buyer,
        space = ANCHOR_DISCRIMINATOR + DomainRecord::INIT_SPACE,
        seeds = [DOMAIN_RECORD_SEED, domain_name.as_bytes()],
        bump
    )]
    pub domain_record: Account<'info, DomainRecord>,

    /// Program state account, storing global configuration and statistics
    #[account(
        mut,
        seeds = [PROGRAM_STATE_SEED],
        bump = program_state.bump
    )]
    pub program_state: Account<'info, ProgramState>,

    /// Pyth price oracle account (SOL/USD price)
    /// Used to calculate accurate SOL amounts
    pub pyth_price_update: Account<'info, PriceUpdateV2>,

    /// Solana system program, used for transfer operations
    pub system_program: Program<'info, System>,
}

/// Domain registration instruction handler
/// 
/// # Parameters
/// * `context` - Instruction context, containing all relevant accounts
/// * `domain_name` - Name of the domain to register (without .ca suffix)
/// * `years` - Registration period in years, minimum 1 year
/// * `addresses` - List of blockchain addresses to set for the domain
/// * `owner` - Owner of the domain, can be any public key, not necessarily the transaction signer
/// 
/// # Errors
/// * `InvalidDomainLength` - Domain name length is invalid (empty or longer than 253 characters)
/// * `InvalidRegisterYears` - Registration period is invalid (less than 1 year)
pub fn register_domain_handler(
    context: Context<RegisterDomainAccountConstraints>,
    domain_name: String,
    years: u64,
    addresses: Vec<ChainAddress>,
    owner: Pubkey,
) -> Result<()> {
    // verify domain name length: > 0 && <= 253 (from state definition)
    require!(
        domain_name.len() > 0 && domain_name.len() <= 253,
        CaRegistrarError::InvalidDomainLength
    );

    // verify years: > 0 && <= 99 
    require!(years > 0 && years <= 99, CaRegistrarError::InvalidRegisterYears);

    // get current timestamp
    let current_timestamp = get_current_timestamp()?;

    // Calculate fee using Pyth oracle
    let yearly_fee = calculate_yearly_fee_in_lamports(
        &context.accounts.pyth_price_update,
        context.accounts.program_state.base_price_usd,  // Pass price value directly
        years,
    )?;
    
    // Transfer fee to program state account
    transfer(
        CpiContext::new(
            context.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: context.accounts.buyer.to_account_info(),
                to: context.accounts.program_state.to_account_info(),
            },
        ),
        yearly_fee,
    )?;

    // Update domain record
    let domain_record = &mut context.accounts.domain_record;
    domain_record.domain_name = domain_name;
    domain_record.owner = owner;
    domain_record.registration_timestamp = current_timestamp;
    domain_record.expiry_timestamp = calculate_expiry_timestamp(current_timestamp, years);
    domain_record.addresses = addresses;
    domain_record.bump = context.bumps.domain_record;

    // Update program state
    let program_state = &mut context.accounts.program_state;
    program_state.domains_registered += 1;

    msg!("Domain {} registered successfully for {} years with owner {}", 
        domain_record.domain_name, years, owner);
    
    Ok(())
} 