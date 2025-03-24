#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use crate::constants::*;
use crate::state::*;
use crate::error::CaRegistrarError;
use crate::instructions::utils::*;

/// Account constraints for updating a domain's expiry timestamp
/// 
/// This admin instruction allows the program authority to modify the expiry date of any domain.
/// Can set the expiry to any time, including past times for testing purposes.
#[derive(Accounts)]
#[instruction(domain_name: String)]
pub struct UpdateExpiryAccountConstraints<'info> {
    /// Program authority that can execute admin commands
    pub authority: Signer<'info>,

    /// Program state account that stores global configuration and authority
    #[account(
        seeds = [PROGRAM_STATE_SEED],
        bump = program_state.bump,
        has_one = authority,
    )]
    pub program_state: Account<'info, ProgramState>,

    /// Domain record to update
    #[account(
        mut,
        seeds = [DOMAIN_RECORD_SEED, domain_name.as_bytes()],
        bump = domain_record.bump
    )]
    pub domain_record: Account<'info, DomainRecord>,
}

/// Update a domain's expiry timestamp
/// 
/// # Parameters
/// * `context` - Instruction context, containing all relevant accounts
/// * `domain_name` - Name of the domain to update
/// * `new_expiry_timestamp` - New expiry timestamp for the domain (can be in past for testing)
pub fn update_expiry_handler(
    context: Context<UpdateExpiryAccountConstraints>,
    domain_name: String,
    new_expiry_timestamp: i64,
) -> Result<()> {
    // Get current timestamp
    let current_timestamp = get_current_timestamp()?;
    
    // Get domain record
    let domain_record = &mut context.accounts.domain_record;
    
    // 保存旧的过期时间用于日志记录
    let old_expiry = domain_record.expiry_timestamp;
    
    // Update domain expiry timestamp
    domain_record.expiry_timestamp = new_expiry_timestamp;
    
    msg!("Updated expiry timestamp for domain {} from {} to {} (current time: {})", 
        domain_name, old_expiry, new_expiry_timestamp, current_timestamp);
    
    Ok(())
} 