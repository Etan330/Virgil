// Scripted conversation used by the demo/mock driver.
// Scenario: a requirements-alignment call. Two counterparties bring a
// requirement (operations + design); the user is the PM who has to confirm
// scope, budget and dates. Shows the full loop: transcript with speaker
// badges (我 / TA / TA2) -> structured summary -> copilot cards raised while
// the counterparts talk -> cards turning ✓ confirmed right after the user
// says the corresponding line.
//
// Writing rules for lines:
//  - lines should sound like real people on a call (fillers, half-sentences)
//  - suggested_text on a card is a HINT, so the user's scripted reply must
//    paraphrase it, never read it verbatim

import type { CardType } from '../../shared/types';

export interface DemoCard {
  type: CardType;
  title: string;
  context: string;
  suggested_text: string;
}

export interface DemoLine {
  /** '我' (the user), 'TA' (operations 王莉), 'TA2' (design 陈默). */
  speaker: '我' | 'TA' | 'TA2';
  text: string;
  summary: string[];
  /** Silence after this line finishes, ms (defaults to 6500). */
  pauseMs?: number;
  cards?: DemoCard[];
  /** Titles of pending cards that this line should flip to Confirmed. */
  resolves?: Array<{
    title: string;
    reason: 'user_asked' | 'user_replied' | 'answered_by_counterpart' | 'expired';
  }>;
}

/** Title assigned to the demo session (never routed through the AI). */
export const DEMO_TITLE = '演示 · 邀请活动需求对齐';

export const DEMO_SCRIPT: DemoLine[] = [
  {
    speaker: 'TA',
    text: '喂，听得见吧？我是运营王莉。是这样啊，老板想在下个版本里加个邀请好友的活动，拉新有奖励，这事已经拍板了。',
    summary: ['【要点】运营王莉提出：下个版本上线"邀请好友"拉新活动，老板已拍板'],
    pauseMs: 5200,
    cards: [
      {
        type: 'need_to_ask',
        title: '确认奖励发放形式',
        context: '发优惠券还是建积分体系，直接决定后端的工作量，必须先定。',
        suggested_text: '先问清楚：奖励是走现有优惠券，还是单独做一套积分？',
      },
      {
        type: 'suggested_reply',
        title: '接住活动需求',
        context: '对方刚抛出需求并强调老板拍板，先接住需求再谈细节，推进更顺。',
        suggested_text: '咱们先把奖励形式和一期范围聊具体一点。',
      },
    ],
  },
  {
    speaker: 'TA',
    text: '对了对了，时间上有点赶，老板的意思是这个月必须上，不然 Q3 拉新指标就悬了嘛。',
    summary: [
      '【要点】运营王莉提出：下个版本上线"邀请好友"拉新活动，老板已拍板',
      '【风险】月底必须上线，时间紧',
    ],
    pauseMs: 4800,
    cards: [
      {
        type: 'need_to_ask',
        title: '确认预算走哪边',
        context: '奖励是长期支出，走哪个预算口子需要先钉死，避免后期扯皮。',
        suggested_text: '这个活动的奖励预算从哪个口子出？市场还是运营？',
      },
    ],
  },
  {
    speaker: '我',
    text: '嗯行。那有个关键点我得先定下来：奖励怎么发？直接挂现有优惠券，还是后端单独搭一套积分？这俩的工作量差挺多的。',
    summary: [
      '【要点】需求：邀请好友拉新活动，月底上线',
      '【风险】时间紧',
      '【要点】已向对方确认奖励发放形式',
    ],
    pauseMs: 5600,
    resolves: [{ title: '确认奖励发放形式', reason: 'user_asked' }],
  },
  {
    speaker: 'TA2',
    text: '我插一句啊，我是设计陈默。视觉不用等你们定，我可以先出两版；但那个邀请海报，要是想要全新创意的话，起码给我五个工作日。',
    summary: [
      '【要点】需求：邀请好友拉新活动，月底上线',
      '【要点】设计陈默：常规视觉两版可选，全新海报需 5 个工作日',
    ],
    pauseMs: 5000,
    cards: [
      {
        type: 'need_to_ask',
        title: '确认海报是否进一期',
        context: '全新海报要 5 个工作日，月底上线的压力下必须决定一期做不做。',
        suggested_text: '海报这种放二期行不行？一期先拿分享卡片模板顶上。',
      },
    ],
  },
  {
    speaker: '我',
    text: '海报咱放二期吧，别卡在这一块。一期就一个邀请页，视觉直接用分享卡片的模板改，陈默你就出一页，压力小点。',
    summary: [
      '【结论】一期范围：仅邀请页，视觉复用分享卡片模板；邀请海报放二期',
      '【要点】设计陈默：常规视觉两版可选',
    ],
    pauseMs: 5400,
  },
  {
    speaker: 'TA',
    text: '同意，海报放二期，一期就邀请页。后端我问过了啊，优惠券那套系统直接就能挂邀请奖励，积分不用新做，钱走市场预算，这块他们没意见。',
    summary: [
      '【结论】一期范围：仅邀请页，视觉复用分享卡片模板；邀请海报放二期',
      '【结论】奖励直接发优惠券，复用现有系统，费用走市场预算',
    ],
    pauseMs: 5000,
    resolves: [
      { title: '确认海报是否进一期', reason: 'answered_by_counterpart' },
      { title: '确认预算走哪边', reason: 'answered_by_counterpart' },
    ],
  },
  {
    speaker: '我',
    text: 'OK，那范围就锁了啊：一期邀请页加优惠券发放，其他都往后放。还有一个数我得要：拉新多少算跑通这个活动？',
    summary: [
      '【结论】一期范围：仅邀请页，视觉复用分享卡片模板；邀请海报放二期',
      '【结论】奖励直接发优惠券，复用现有系统，费用走市场预算',
      '【要点】已向对方确认拉新达标目标',
    ],
    pauseMs: 4600,
    cards: [
      {
        type: 'need_to_ask',
        title: '确认拉新目标数',
        context: '没有达标数就没法定奖励额度和活动结案标准。',
        suggested_text: '给个准数：这次拉新到多少算这个活动成了？',
      },
    ],
  },
  {
    speaker: 'TA',
    text: '五千。老板原话是五千个新用户，到了才发奖，没到的话按实际拉新打个七折折算。',
    summary: [
      '【结论】一期范围：仅邀请页，视觉复用分享卡片模板；邀请海报放二期',
      '【结论】奖励直接发优惠券，费用走市场预算；目标 5000 新用户，未达标七折折算',
    ],
    pauseMs: 5200,
    resolves: [{ title: '确认拉新目标数', reason: 'answered_by_counterpart' }],
  },
  {
    speaker: 'TA2',
    text: '那设计稿我周四下班前发群里。哦对了，规则页的文案得王莉先给我，不然我没法排。',
    summary: [
      '【结论】一期范围：仅邀请页，视觉复用分享卡片模板；邀请海报放二期',
      '【结论】奖励直接发优惠券，费用走市场预算；目标 5000 新用户',
      '【待办】陈默周四交付邀请页设计稿；规则页文案依赖王莉',
    ],
    pauseMs: 4800,
    cards: [
      {
        type: 'suggested_reply',
        title: '回应设计排期',
        context: '对方给出了交稿时间，下一步需要明确如何收集和确认反馈。',
        suggested_text: '稿子出来后，我们怎么收集和确认反馈？',
      },
    ],
  },
  {
    speaker: '我',
    text: '可以，稿子出来后咱们按什么流程收意见？我下午先同步一下研发测试，等排期确认再发群里。哦还有个事我得提一嘴：优惠券发放的额度，最好让财务提前看一眼，别到时候卡在钱上。',
    summary: [
      '【结论】一期范围：仅邀请页，视觉复用分享卡片模板；邀请海报放二期',
      '【结论】奖励直接发优惠券，费用走市场预算；目标 5000 新用户',
      '【待办】陈默周四交设计稿；我今天同步研发测试，排期确认后发群里；稿后反馈流程待确认',
      '【风险】优惠券发放额度需财务确认',
    ],
    pauseMs: 5000,
    resolves: [{ title: '回应设计排期', reason: 'user_replied' }],
  },
  {
    speaker: 'TA',
    text: '财务我去磨，你把单个新用户的奖励上限估个数发我就行。行，那今天就先这样，有变化群里喊。',
    summary: [
      '【结论】一期范围：仅邀请页，视觉复用分享卡片模板；邀请海报放二期',
      '【结论】奖励直接发优惠券，费用走市场预算；目标 5000 新用户',
      '【待办】我发奖励上限预估给王莉；王莉对接财务；陈默周四交设计稿',
    ],
    pauseMs: 4000,
  },
];
