#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use crate::constants::*;
use crate::state::*;
use crate::instructions::utils::*;
use crate::error::CaRegistrarError;

/// Account constraints for transferring domain ownership instruction
/// 
/// This instruction allows domain owners to transfer their domain to another user.
#[derive(Accounts)]
#[instruction(domain_name: String)]
pub struct TransferDomainAccountConstraints<'info> {
    /// Current domain owner
    pub owner: Signer<'info>,

    /// Domain record to transfer
    #[account(
        mut,
        has_one = owner,
        seeds = [DOMAIN_RECORD_SEED, domain_record.domain_name.as_bytes()],
        bump = domain_record.bump
    )]
    pub domain_record: Account<'info, DomainRecord>,
}

/// Transfer domain ownership to a new user
/// 
/// # Parameters
/// * `context` - Instruction context, containing all relevant accounts
/// * `new_owner` - Public key of the new owner
/// 
/// # Errors
/// * `DomainExpired` - Domain has expired
pub fn transfer_domain_handler(
    context: Context<TransferDomainAccountConstraints>,
    new_owner: Pubkey,
) -> Result<()> {
    // Get current timestamp
    let current_timestamp = get_current_timestamp()?;
    
    // Verify domain is not expired
    let domain_record = &mut context.accounts.domain_record;
    require!(
        !domain_record.is_expired(current_timestamp),
        CaRegistrarError::DomainExpired
    );
    
    // Update domain owner
    domain_record.owner = new_owner;
    
    msg!("Transferred domain {} to new owner {}", domain_record.domain_name, new_owner);
    
    Ok(())
} 