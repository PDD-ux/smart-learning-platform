import {apiRequest} from './api';
import type {CreateTopic,TopicCommand,TopicView,TopicPreview,TopicAnswer,TopicList,TopicCandidates} from '@/lib/study-topics/contracts';
export const studyTopics={
 list:():Promise<TopicList>=>apiRequest('/api/study-topics'),
 candidates:(page=1):Promise<TopicCandidates>=>apiRequest('/api/study-topics/candidates?page='+page),
 read:(id:string):Promise<TopicView>=>apiRequest('/api/study-topics/'+encodeURIComponent(id)),
 create:(input:CreateTopic):Promise<TopicView>=>apiRequest('/api/study-topics',{method:'POST',body:input}),
 command:(id:string,input:TopicCommand,signal?:AbortSignal):Promise<{topic?:TopicView;preview?:TopicPreview;answer?:TopicAnswer;text?:string;fileName?:string}>=>apiRequest('/api/study-topics/'+encodeURIComponent(id),{method:'POST',body:input,signal}),
};
