#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, transfer};
use crate::constants::*;
use crate::state::*;
use crate::instructions::utils::*;
use crate::instructions::register::utils::*;
use crate::error::CaRegistrarError;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

/// Account constraints for buying an expired domain instruction
/// 
/// This instruction allows users to purchase domains that have expired and are beyond the grace period.
/// This operation completely resets domain ownership and clears all address records.
#[derive(Accounts)]
#[instruction(domain_name: String)]
pub struct BuyDomainAccountConstraints<'info> {
    /// User paying for domain purchase, who will also become the new domain owner
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// Domain record account to be purchased
    #[account(
        mut,
        seeds = [DOMAIN_RECORD_SEED, domain_name.as_bytes()],
        bump = domain_record.bump,
    )]
    pub domain_record: Account<'info, DomainRecord>,

    /// Program state account
    #[account(
        mut,
        seeds = [PROGRAM_STATE_SEED],
        bump = program_state.bump
    )]
    pub program_state: Account<'info, ProgramState>,

    /// Pyth price oracle account (SOL/USD price)
    /// Used to calculate accurate SOL amounts
    pub pyth_price_update: Account<'info, PriceUpdateV2>,

    pub system_program: Program<'info, System>,
}

/// Instruction handler for buying expired domains
/// 
/// # Parameters
/// * `context` - Instruction context, containing all relevant accounts
/// * `years` - Purchase period in years, minimum 1 year
/// * `addresses` - List of blockchain addresses to set for the domain
/// * `owner` - Owner of the domain, can be any public key, not necessarily the transaction signer
/// 
/// # Errors
/// * `InvalidRegisterYears` - Registration period is invalid
pub fn buy_domain_handler(
    context: Context<BuyDomainAccountConstraints>,
    years: u64,
    addresses: Vec<ChainAddress>,
    owner: Pubkey,
) -> Result<()> {
    // Validate years
    require!(years > 0 && years <= 99, CaRegistrarError::InvalidRegisterYears);

    // Get current timestamp
    let current_timestamp = get_current_timestamp()?;
    
    // Get domain record and program state
    let domain_record = &mut context.accounts.domain_record;
    let program_state = &context.accounts.program_state;
    
    // Check if domain is expired and beyond grace period
    let is_expired = domain_record.is_expired(current_timestamp);
    let is_in_grace_period = domain_record.is_in_grace_period(
        current_timestamp, 
        program_state.grace_period_seconds
    );
    
    // Only allow purchase of domains that are expired and beyond grace period
    require!(
        is_expired && !is_in_grace_period,
        CaRegistrarError::DomainNotAvailableForPurchase
    );
    
    // Calculate fee using Pyth oracle
    let yearly_fee = calculate_yearly_fee_in_lamports(
        &context.accounts.pyth_price_update,
        context.accounts.program_state.base_price_usd, 
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

    // Reset and update domain record
    domain_record.owner = owner;
    domain_record.registration_timestamp = current_timestamp;
    domain_record.expiry_timestamp = calculate_expiry_timestamp(current_timestamp, years);
    domain_record.addresses = addresses; 

    msg!("Domain {} purchased successfully for {} years with owner {}", 
        domain_record.domain_name, years, owner);
    
    Ok(())
} 